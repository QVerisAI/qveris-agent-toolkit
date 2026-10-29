import { resolveBaseUrl } from "../config/endpoint.mjs";
import { CliError } from "../errors/handler.mjs";
import { showTrial } from "./trial-output.mjs";
import { runBoundedTrial } from "./bounded-trial.mjs";
export { publicTrial } from "./trial-output.mjs";
import {
  beginTrialRegistration,
  getTrialRegistration,
  exportTrialCredential,
  recoverTrialRegistration,
  persistTrialCredential,
  recordTrialFailure,
  validTrialData,
} from "../auth/trial-storage.mjs";

export async function runTrial(flags) {
  if (flags.bounded || getTrialRegistration()?.policy === "bounded_agent_trial_v1") return runBoundedTrial(flags);
  if (flags.export) {
    const { registration, secret } = await exportTrialCredential();
    return showTrial(registration, flags, secret);
  }
  let existing = getTrialRegistration();
  if (existing && ["pending", "unknown"].includes(existing.state)) {
    try {
      existing = await recoverTrialRegistration();
    } catch {
      throw new CliError("TRIAL_STORAGE_FAILED");
    }
  }
  if (existing?.state === "issued") return showTrial(existing, flags);
  if (existing && !["rejected"].includes(existing.state)) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  if (flags.agentName !== undefined && (!flags.agentName.trim() || flags.agentName.length > 100))
    throw new CliError("API_ERROR", "--agent-name must contain 1–100 characters");
  const { baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  const { created, registration } = await beginTrialRegistration({
    baseUrl,
    allowUnencryptedStorage: flags.allowUnencryptedStorage,
    apiKeyFlag: flags.apiKey,
  });
  if (!created) {
    if (registration.state === "issued") return showTrial(registration, flags);
    throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  }
  let data;
  try {
    // This mutation has no idempotency/recovery contract. Submit it once;
    // never use ordinary read retries, OAuth replay, or redirects here.
    const response = await fetch(`${baseUrl}/agent/anonymous-register`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(flags.agentName ? { agent_name: flags.agentName.trim() } : {}),
    });
    if ([401, 403, 422, 429].includes(response.status)) {
      await recordTrialFailure(registration, { rejected: true });
      throw new CliError(
        response.status === 429 ? "RATE_LIMITED" : "API_ERROR",
        response.status === 429
          ? "Trial registration rate limited; no account was issued by this response"
          : `Trial registration rejected (HTTP ${response.status})`,
      );
    }
    if (!response.ok) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    const payload = await response.json();
    data = payload?.status === "success" && payload.status_code === 0 ? payload.data : null;
    if (!validTrialData(data)) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
  } catch (error) {
    const journal = getTrialRegistration();
    if (journal?.state !== "rejected") {
      await recordTrialFailure(registration);
      throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    }
    throw error;
  }
  let saved;
  try {
    saved = await persistTrialCredential(registration, data);
  } catch {
    try {
      await recordTrialFailure(registration);
    } catch {
      /* Pending journal still prevents resubmission. */
    }
    throw new CliError("TRIAL_STORAGE_FAILED");
  }
  showTrial(saved, flags);
}
