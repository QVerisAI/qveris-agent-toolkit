import type { ExecutionRestrictions, ProbeResponse, ToolInfo } from './types.js';

function guidance(action: string, reason: string, message: string) {
  return { action, reason, message, automatic: false };
}

export function isPublicContext(searchId: unknown): boolean {
  return typeof searchId === 'string' && searchId.startsWith('pub_');
}

export function publicGuidance() {
  return {
    ...guidance(
      'connect_qveris_execution',
      'public_readonly',
      'This QVeris context supports only Discover and Inspect. Connect to the authenticated QVeris execution endpoint for the same deployment. Keep the tool ID and inputs, then Inspect without the public search_id; use the fresh authenticated context before Call.',
    ),
    allowed_actions: ['discover', 'inspect'],
  };
}

function prohibited(r: ExecutionRestrictions | undefined, ignoreTechnical = false): boolean {
  return (
    r?.eligibility === 'restricted' ||
    r?.license === 'restricted' ||
    r?.commercial_use === 'prohibited' ||
    r?.region_status === 'blocked' ||
    r?.authentication === 'blocked' ||
    (!ignoreTechnical && r?.technical === 'blocked')
  );
}

function catalogGuidance(tool: ToolInfo, publicContext: boolean) {
  const r = tool.execution_restrictions;
  if (prohibited(r) || r?.next_action === 'switch_provider') {
    return guidance(
      'select_allowed_provider',
      'catalog_execution_prohibited',
      'Current policy directs away from this selection. Choose another capability.',
    );
  }
  if (
    !publicContext &&
    (r?.callable === false ||
      r?.blocked_actions?.includes('execute') ||
      (r?.next_action && r.next_action !== 'execute'))
  ) {
    return guidance(
      'inspect_then_probe_once',
      'catalog_execution_not_confirmed',
      'Directory evidence does not confirm execution. Check the current contract and any explicit restriction; use one authenticated Probe if admission, inputs or a quote need confirmation. Stop if still unresolved.',
    );
  }
  return undefined;
}

export function withCatalogGuidance<
  T extends { search_id?: string; contract_features?: string[]; results?: ToolInfo[] },
>(result: T) {
  const publicContext =
    isPublicContext(result.search_id) || result.contract_features?.includes('public-readonly-v1') === true;
  const results = result.results?.map((tool) => {
    const advice = catalogGuidance(tool, publicContext);
    return advice ? { ...tool, execution_guidance: advice } : tool;
  });
  return { ...result, ...(results && { results }), ...(publicContext && { execution_guidance: publicGuidance() }) };
}

export function probeGuidance(probe: ProbeResponse, requireQuote: boolean) {
  const r = probe.execution_restrictions;
  const reason = probe.reason;
  if (
    probe.exists === false ||
    ['tool_unavailable', 'tool_disabled', 'region_restricted'].includes(reason ?? '') ||
    prohibited(r, reason === 'realtime_unavailable')
  ) {
    return guidance(
      'select_allowed_provider',
      ['tool_unavailable', 'tool_disabled', 'region_restricted'].includes(reason ?? '')
        ? (reason ?? 'execution_prohibited')
        : 'execution_prohibited',
      'Current execution is unavailable or prohibited for this selection. Do not Call it.',
    );
  }
  if (reason === 'insufficient_scope')
    return guidance(
      'request_qveris_execute_scope',
      reason,
      'Use a QVeris credential with execution scope; provider sign-in will not fix this.',
    );
  if (reason === 'oauth2_signin_required')
    return guidance(
      'sign_in_to_provider',
      reason,
      'This tool requires provider sign-in. If the host does not expose the provider connection flow, continue in a supporting QVeris client or select another capability.',
    );
  if (reason === 'delegation_budget_not_supported')
    return guidance(
      'change_delegation_or_select_provider',
      reason,
      'Use an authorized credential with a supported budget policy or choose another capability; signing in again does not fix this budget.',
    );
  if (reason === 'realtime_unavailable')
    return guidance(
      'retry_probe_once_or_select_provider',
      reason,
      'The tool is temporarily unavailable. Retry the read-only Probe at most once or choose another capability.',
    );
  if (probe.schema?.valid === false)
    return guidance('correct_parameters', 'invalid_parameters', 'Correct the current inputs before a new Probe.');
  const actions = [r?.next_action, probe.recovery?.next_action].filter((value) => value !== undefined);
  if (actions.includes('switch_provider'))
    return guidance(
      'select_allowed_provider',
      'execution_not_admitted',
      'Current guidance recommends another provider. Do not Call this selection.',
    );
  const quote = probe.quote;
  const usableQuote =
    quote?.currency === 'credits' &&
    typeof quote.estimate_credits === 'number' &&
    Number.isFinite(quote.estimate_credits) &&
    quote.estimate_credits >= 0 &&
    typeof quote.exact === 'boolean';
  if ((requireQuote && !usableQuote) || actions.includes('confirm_budget'))
    return guidance(
      'confirm_budget',
      'quote_or_budget_confirmation_required',
      'Review a usable current quote and the applicable budget before Call.',
    );
  const conflicting =
    r?.callable === false ||
    r?.blocked_actions?.includes('execute') ||
    (Array.isArray(r?.allowed_actions) && !r.allowed_actions.includes('execute')) ||
    actions.some((action) => action !== 'execute');
  if (probe.executable === true && !conflicting && !reason)
    return guidance(
      'review_and_call',
      'execution_preflight_ready',
      'Call once only after the current input and cost requirements are met.',
    );
  return guidance(
    'stop_and_review_preflight',
    'execution_guidance_unresolved',
    'Current preflight did not confirm execution. Review the latest evidence or select another capability; do not loop through Inspect, Probe or login.',
  );
}
