import { isPublicDiscoveryContext } from "../client/public-discovery.mjs";

const DENIED = new Set(["tool_unavailable", "tool_disabled", "region_restricted"]);
const AUTH_ACTIONS = new Map([
  [
    "insufficient_scope",
    [
      "request_qveris_execute_scope",
      "Use a QVeris credential with execution scope; provider sign-in will not fix this.",
    ],
  ],
  [
    "oauth2_signin_required",
    [
      "sign_in_to_provider",
      "This tool requires provider sign-in. This CLI does not initiate it; continue in a QVeris client that supports that provider connection or select another capability.",
    ],
  ],
  [
    "delegation_budget_not_supported",
    [
      "change_delegation_or_select_provider",
      "Use an authorized credential with a supported budget policy or choose another capability; signing in again does not fix this budget.",
    ],
  ],
]);

function guidance(action, reason, message, extra = {}) {
  return { action, reason, message, automatic: false, ...extra };
}

export function publicExecutionGuidance(response, explicit = false) {
  if (
    !explicit &&
    !isPublicDiscoveryContext(response?.search_id) &&
    !response?.contract_features?.includes?.("public-readonly-v1")
  )
    return null;
  return guidance(
    "connect_qveris_execution",
    "public_readonly",
    "This QVeris public session supports only Discover and Inspect. This is not a provider login requirement. On the same endpoint, use qveris auth login or a privately configured key, then run qveris inspect <tool-id> without --public-read-only or a public discovery ID. Keep the selected tool and inputs; review any required quote before Call.",
    { allowed_actions: ["discover", "inspect"] },
  );
}

export function catalogExecutionProhibited(tool, { ignoreTechnical = false } = {}) {
  const r = tool?.execution_restrictions;
  return (
    r?.eligibility === "restricted" ||
    r?.license === "restricted" ||
    r?.commercial_use === "prohibited" ||
    r?.region_status === "blocked" ||
    r?.authentication === "blocked" ||
    (!ignoreTechnical && r?.technical === "blocked")
  );
}

export function catalogExecutionGuidance(tool) {
  const r = tool?.execution_restrictions;
  if (catalogExecutionProhibited(tool) || r?.next_action === "switch_provider")
    return guidance(
      "select_allowed_provider",
      "catalog_execution_prohibited",
      "The catalog reports an explicit execution restriction. Do not Call this selection.",
    );
  if (
    r?.callable === false ||
    r?.blocked_actions?.includes?.("execute") ||
    (r?.next_action && r.next_action !== "execute")
  ) {
    return guidance(
      "inspect_then_probe_once",
      "catalog_execution_not_confirmed",
      "Directory evidence does not confirm execution. Check the current contract and any explicit restriction; use one authenticated Probe if admission, inputs or a quote need confirmation. Stop if still unresolved.",
    );
  }
  return null;
}

export function probeExecutionGuidance(probe, { requireQuote = false } = {}) {
  const r = probe?.execution_restrictions;
  const reason = probe?.reason;
  const auth = AUTH_ACTIONS.get(reason);
  if (
    probe?.exists === false ||
    DENIED.has(reason) ||
    catalogExecutionProhibited(probe, { ignoreTechnical: reason === "realtime_unavailable" })
  ) {
    return guidance(
      "select_allowed_provider",
      DENIED.has(reason) ? reason : "execution_prohibited",
      "Current execution is unavailable or prohibited for this selection. Do not Call it.",
    );
  }
  if (auth) return guidance(auth[0], reason, auth[1]);
  if (reason === "realtime_unavailable")
    return guidance(
      "retry_probe_once_or_select_provider",
      reason,
      "The tool is temporarily unavailable. Retry the read-only Probe at most once or choose another capability.",
    );
  if (probe?.schema?.valid === false)
    return guidance("correct_parameters", "invalid_parameters", "Correct the current inputs before a new Probe.");
  const actions = [r?.next_action, probe?.recovery?.next_action].filter((value) => value !== undefined);
  if (actions.includes("switch_provider"))
    return guidance(
      "select_allowed_provider",
      "execution_not_admitted",
      "Current guidance recommends another provider. Do not Call this selection.",
    );
  const quote = probe?.quote;
  const usableQuote =
    quote?.currency === "credits" &&
    typeof quote.estimate_credits === "number" &&
    Number.isFinite(quote.estimate_credits) &&
    quote.estimate_credits >= 0 &&
    typeof quote.exact === "boolean";
  if ((requireQuote && !usableQuote) || actions.includes("confirm_budget"))
    return guidance(
      "confirm_budget",
      "quote_or_budget_confirmation_required",
      "Review a usable current quote and the applicable budget before Call.",
    );
  const conflicting =
    r?.callable === false ||
    r?.blocked_actions?.includes?.("execute") ||
    (Array.isArray(r?.allowed_actions) && !r.allowed_actions.includes("execute")) ||
    actions.some((action) => action !== "execute");
  if (probe?.executable === true && !conflicting && !reason)
    return guidance(
      "review_and_call",
      "execution_preflight_ready",
      "Call once only after the current input and cost requirements are met.",
    );
  return guidance(
    "stop_and_review_preflight",
    "execution_guidance_unresolved",
    "Current preflight did not confirm execution. Review the latest evidence or select another capability; do not loop through Inspect, Probe or login.",
  );
}

export function withCatalogExecutionGuidance(response, publicReadOnly) {
  const publicGuidance = publicExecutionGuidance(response, publicReadOnly);
  if (!Array.isArray(response?.results)) return response;
  return {
    ...response,
    ...(publicGuidance && { execution_guidance: publicGuidance }),
    results: response.results.map((tool) => {
      const advice =
        !publicGuidance || tool?.execution_restrictions?.next_action === "switch_provider"
          ? catalogExecutionGuidance(tool)
          : null;
      return advice ? { ...tool, execution_guidance: advice } : tool;
    }),
  };
}
