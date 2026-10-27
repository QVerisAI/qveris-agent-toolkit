import { resolveBaseUrl, getSiteUrl } from "../config/endpoint.mjs";
import { CliError } from "../errors/handler.mjs";
import { outputJson } from "../output/json.mjs";
import {
  beginTrialRegistration,
  getTrialRegistration,
  exportTrialCredential,
  recoverTrialRegistration,
  persistTrialCredential,
  recordTrialFailure,
  validTrialData,
} from "../auth/trial-storage.mjs";

export function publicTrial(registration) {
  return {
    state: registration.state,
    recovery_pending: registration.recovery_pending,
    operation_id: registration.operation_id,
    endpoint: registration.base_url,
    storage: registration.storage,
    active: registration.active ?? false,
    agent_id: registration.agent_id,
    trial_credits: registration.trial_credits,
    expires_at: registration.expires_at,
    expired: registration.expires_at ? Date.parse(registration.expires_at) <= Date.now() : undefined,
    policy: "legacy_agent_trial",
    strict_credit_budget: false,
    claim_guide: `${getSiteUrl(registration.base_url)}/auth.md`,
  };
}

function showTrial(registration, flags, secret) {
  const result = {
    ...publicTrial(registration),
    ...(secret && { api_key: secret.api_key, claim_code: secret.claim_code }),
  };
  if (flags.json || flags.export) return outputJson(result);
  console.log(`  Trial credentials saved (${registration.storage}).`);
  console.log(`  Endpoint: ${registration.base_url}`);
  console.log(`  Issued credits: ${registration.trial_credits}; expires: ${registration.expires_at}`);
  console.log(
    "  Policy: legacy Agent trial; separate from the browser trial policy. No strict credit cap is promised by this command.",
  );
  console.log("  Use qveris auth trial --export to explicitly export the stored key and claim code.");
  console.log(`  Claim guidance: ${result.claim_guide}`);
  if (registration.active === false) console.log("  An existing credential takes precedence; it was preserved.");
}

export async function runTrial(flags) {
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
