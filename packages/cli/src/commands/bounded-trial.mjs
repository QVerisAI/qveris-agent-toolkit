import { resolveBaseUrl } from "../config/endpoint.mjs";
import { CliError } from "../errors/handler.mjs";
import {
  assertTrialActivationAllowed,
  recordTrialTerminal,
  beginTrialRegistration,
  getTrialRegistration,
  getTrialPossession,
  exportTrialCredential,
  recoverTrialRegistration,
  persistTrialCredential,
  recordTrialFailure,
  validTrialData,
} from "../auth/trial-storage.mjs";
import { showTrial } from "./trial-output.mjs";

const POLICY = "bounded_agent_trial_v1";
const absoluteTime = (value) =>
  typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const credits = (value) =>
  typeof value === "string" &&
  value.length <= 40 &&
  /^\d+(?:\.\d+)?$/.test(value) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 1;

function sessionView(payload) {
  const data = payload?.status === "success" && payload.status_code === 0 ? payload.data : null;
  if (
    !data ||
    !["prepared", "active"].includes(data.state) ||
    !absoluteTime(data.expiresAt) ||
    !credits(data.trialCredits)
  )
    throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  return data;
}

/** Every mutation uses the possession persisted before the first network call. */
export async function runBoundedTrial(flags) {
  if (flags.export) {
    const { registration, secret } = await exportTrialCredential();
    return showTrial(registration, flags, secret);
  }
  if (flags.agentName !== undefined && (!flags.agentName.trim() || flags.agentName.trim().length > 80))
    throw new CliError("API_ERROR", "--agent-name must contain 1–80 characters");
  let registration = getTrialRegistration();
  if (registration && registration.policy !== POLICY && registration.state !== "rejected")
    throw new CliError("TRIAL_CREDENTIAL_EXISTS");
  if (
    registration?.policy === POLICY &&
    flags.baseUrl &&
    resolveBaseUrl({ baseUrlFlag: flags.baseUrl }).baseUrl !== registration.base_url
  )
    throw new CliError(
      "API_ERROR",
      "Stored trial belongs to another API endpoint; keep recovery on its original endpoint",
    );
  if (registration?.state === "claimed") throw new CliError("TRIAL_ALREADY_CLAIMED");
  if (["revoked", "expired"].includes(registration?.state)) throw new CliError("TRIAL_EXPIRED");
  if (registration?.state === "logged_out") throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  if (registration?.policy === POLICY) registration = await recoverTrialRegistration();
  if (registration?.state === "issued") return showTrial(registration, flags);
  let created = false;
  if (!registration || registration.state === "rejected") {
    const { baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
    ({ created, registration } = await beginTrialRegistration({
      baseUrl,
      allowUnencryptedStorage: flags.allowUnencryptedStorage,
      apiKeyFlag: flags.apiKey,
      policy: POLICY,
    }));
  }
  const proof = await getTrialPossession(registration);
  const base = `${registration.base_url}/agent/trial`;
  const request = async (path, method, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${proof}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 404) throw new CliError("TRIAL_BOUNDED_UNAVAILABLE");
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    }
    if (response.status === 429) throw new CliError("RATE_LIMITED");
    if (response.status === 410) {
      if (payload?.data?.error?.code === "trial_claimed") {
        await recordTrialTerminal(registration, "claimed");
        throw new CliError("TRIAL_ALREADY_CLAIMED");
      }
      if (["trial_revoked", "trial_expired"].includes(payload?.data?.error?.code)) {
        await recordTrialTerminal(registration, payload.data.error.code === "trial_revoked" ? "revoked" : "expired");
        throw new CliError("TRIAL_EXPIRED");
      }
      throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    }
    return { response, payload };
  };
  try {
    let view;
    if (!created) {
      const read = await request("/session", "GET");
      if (read.response.ok) view = sessionView(read.payload);
      else if (!(read.response.status === 401 && read.payload?.data?.error?.code === "trial_session_required"))
        throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    }
    if (!view) {
      const prepared = await request("/prepare", "POST");
      if (!prepared.response.ok) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
      view = sessionView(prepared.payload);
    }
    if (view.state === "active") throw new CliError("TRIAL_KEY_RECOVERY_REQUIRED");
    await assertTrialActivationAllowed(registration, { apiKeyFlag: flags.apiKey });
    const activated = await request("/activate", "POST", flags.agentName ? { agentName: flags.agentName.trim() } : {});
    if (!activated.response.ok) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    const data = sessionView(activated.payload);
    if (data.state !== "active") throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    if (!data.api_key) throw new CliError("TRIAL_KEY_RECOVERY_REQUIRED");
    const secret = {
      api_key: data.api_key,
      claim_code: proof,
      agent_id: data.agent_id,
      trial_credits: Number(data.trialCredits),
      expires_at: data.expiresAt,
    };
    if (!validTrialData(secret)) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    let saved;
    try {
      saved = await persistTrialCredential(registration, secret);
    } catch {
      throw new CliError("TRIAL_STORAGE_FAILED");
    }
    return showTrial(saved, flags);
  } catch (error) {
    try {
      await recordTrialFailure(registration);
    } catch {
      throw new CliError("TRIAL_STORAGE_FAILED");
    }
    if (error instanceof CliError) throw error;
    throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  }
}
