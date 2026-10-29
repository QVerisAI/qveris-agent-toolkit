import { getSiteUrl } from "../config/endpoint.mjs";
import { outputJson } from "../output/json.mjs";

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
    expired:
      registration.state === "expired" ||
      (registration.expires_at ? Date.parse(registration.expires_at) <= Date.now() : undefined),
    policy: registration.policy ?? "legacy_agent_trial",
    strict_credit_budget: registration.policy === "bounded_agent_trial_v1",
    ...(registration.policy === "bounded_agent_trial_v1"
      ? { hard_final_cost_cap: false, claim_url: `${getSiteUrl(registration.base_url)}/claim?mode=bounded` }
      : {}),
    claim_guide: `${getSiteUrl(registration.base_url)}/auth.md`,
  };
}

export function showTrial(registration, flags, secret) {
  const result = {
    ...publicTrial(registration),
    ...(secret && {
      api_key: secret.api_key,
      claim_code: secret.claim_code,
      ...(secret.session_token ? { session_token: secret.session_token } : {}),
    }),
  };
  if (flags.json || flags.export) return outputJson(result);
  console.log(`  Trial credentials saved (${registration.storage}).`);
  console.log(`  Endpoint: ${registration.base_url}`);
  console.log(`  Issued credits: ${registration.trial_credits}; expires: ${registration.expires_at}`);
  console.log(
    registration.policy === "bounded_agent_trial_v1"
      ? "  Policy: bounded quote admission; actual supplier charges are not a hard price lock."
      : "  Policy: legacy Agent trial; separate from the browser trial policy. No strict credit cap is promised by this command.",
  );
  console.log("  Use qveris auth trial --export to explicitly export the stored key and claim code.");
  console.log(`  Claim guidance: ${result.claim_guide}`);
  if (registration.active === false) console.log("  An existing credential takes precedence; it was preserved.");
}
