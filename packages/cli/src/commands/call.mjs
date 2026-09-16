import {
  createAuthorizationContextCredentialProvider,
  resolveApiKey,
  resolveAuthorizationContextId,
} from "../client/auth.mjs";
import {
  callTool,
  discoverTools,
  getCreditsLedger,
  getUsageHistory,
  inspectToolsByIds,
  probeTool,
  resolveApiBaseUrl,
  unwrapApiResponse,
} from "../client/api.mjs";
import { resolveToolId, getSessionDiscoveryId, readSessionForContext } from "../session/session.mjs";
import { resolveParams } from "../utils/params.mjs";
import { formatCallResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { generateSnippet } from "../output/codegen.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";
import { buildContextDiscoveryQuery, resolveInstallContext } from "../utils/install-context.mjs";
import { analyzeParameterSchema, validateParameters } from "../utils/tool-contract.mjs";
import { classifyPricing, validateQuote } from "../utils/pricing-policy.mjs";

// Smart max_response_size defaults:
//   --max-size N   → user explicit override (highest priority)
//   --json         → 20480 (agent/LLM scenario, matches MCP server)
//   non-TTY        → 20480 (piped/scripted, likely agent)
//   TTY            → 4096  (human terminal, auto-truncate large results)
const MAX_SIZE_TTY = 4096;
const MAX_SIZE_AGENT = 20480;

function resolveMaxSize(flags) {
  if (flags.maxSize !== undefined) {
    const parsed = parseInt(flags.maxSize, 10);
    if (isNaN(parsed)) throw new CliError("API_ERROR", "Invalid --max-size: must be an integer");
    return parsed;
  }
  if (flags.json) return MAX_SIZE_AGENT;
  if (!process.stdout.isTTY) return MAX_SIZE_AGENT;
  return MAX_SIZE_TTY;
}

export async function runCall(idOrIndex, flags) {
  const installContext = flags.context ? resolveInstallContext(flags.context) : null;
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 60) * 1000;
  const maxSize = resolveMaxSize(flags);
  const { baseUrl } = resolveApiBaseUrl({ baseUrlFlag: flags.baseUrl, preferOAuth: apiKey === undefined });

  if (installContext) {
    if (idOrIndex) {
      throw new CliError("CONTEXT_INVALID", "Do not combine a positional tool ID with --context");
    }
    if (flags.discoveryId) {
      throw new CliError("CONTEXT_INVALID", "Do not combine a stored --discovery-id with --context");
    }
    assertContextBudgetSupported(flags.maxCredits);
    const parameters = resolveParams(flags.params || "{}");
    const authorizationContext = await resolveAuthorizationContextId({ apiKey });
    const contextCredentialProvider = createAuthorizationContextCredentialProvider({
      apiKey,
      authorizationContext,
    });
    const current = await resolveCurrentContextTool({
      apiKey,
      credentialProvider: contextCredentialProvider,
      baseUrl,
      context: installContext,
      parameters,
      timeoutMs,
      flags,
    });
    if (current.discoveryOnly) {
      return outputContextCandidates(current, flags);
    }
    return executeCall({
      apiKey,
      credentialProvider: contextCredentialProvider,
      baseUrl,
      toolId: current.toolId,
      discoveryId: current.discoveryId,
      parameters,
      maxSize,
      timeoutMs,
      flags,
      contextMeta: current.contextMeta,
      fallbackCandidates: current.fallbackCandidates,
    });
  }

  const numericIndex = /^\d+$/.test(idOrIndex);
  const usesSessionShortcut = numericIndex || !flags.discoveryId;
  let session = null;
  let credentialProvider;
  if (usesSessionShortcut) {
    const authorizationContext = await resolveAuthorizationContextId({ apiKey });
    credentialProvider = createAuthorizationContextCredentialProvider({ apiKey, authorizationContext });
    const resolvedSession = readSessionForContext({ baseUrl, authorizationContext });
    if (resolvedSession.status === "context_mismatch") {
      throw new CliError(
        "SESSION_EXPIRED",
        "Stored discovery belongs to another API endpoint or authorization context. Run 'qveris discover' again.",
      );
    }
    session = resolvedSession.session;
  }

  const resolved = resolveToolId(idOrIndex, { session });
  if (numericIndex && !resolved.fromSession) {
    throw new CliError("SESSION_EXPIRED", "No matching discovery index. Run 'qveris discover' first.");
  }
  const toolId = resolved.toolId;
  let discoveryId = flags.discoveryId || null;

  if (!discoveryId && resolved.fromSession && resolved.discoveryId) {
    discoveryId = resolved.discoveryId;
  }
  if (!discoveryId) discoveryId = getSessionDiscoveryId({ session });
  if (!discoveryId && /^\d+$/.test(idOrIndex)) {
    throw new CliError("SESSION_EXPIRED", "No discovery ID. Run 'qveris discover' first or pass --discovery-id.");
  }

  const parameters = resolveParams(flags.params || "{}");

  if (flags.dryRun) {
    if (flags.json) {
      outputJson({
        dry_run: true,
        tool_id: toolId,
        discovery_id: discoveryId,
        parameters,
        max_response_size: maxSize,
        ...(flags.respondWith !== undefined && { respond_with: flags.respondWith }),
        ...(flags.model !== undefined && { model: flags.model }),
      });
    } else {
      console.log(`\n  ${bold("Dry run")} -- would send:\n`);
      console.log(`  Tool:         ${cyan(toolId)}`);
      console.log(`  Discovery ID: ${dim(discoveryId)}`);
      console.log(`  Max size:     ${maxSize}`);
      if (flags.respondWith !== undefined) console.log(`  Respond with: ${flags.respondWith}`);
      if (flags.model !== undefined) console.log(`  Model:        ${flags.model}`);
      console.log(`  Parameters:`);
      console.log(
        JSON.stringify(parameters, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );
    }
    return;
  }

  return executeCall({
    apiKey,
    credentialProvider,
    baseUrl,
    toolId,
    discoveryId,
    parameters,
    maxSize,
    timeoutMs,
    flags,
  });
}

function normalizeToolList(response) {
  if (Array.isArray(response)) return response;
  const tools = response?.results ?? response?.tools;
  return Array.isArray(tools) ? tools : null;
}

function contextError(code, detail, metadata = {}) {
  const error = new CliError(code, detail);
  Object.assign(error, metadata);
  if (error.nextAction === undefined) {
    error.nextAction = buildNextAction(error.action ?? "review_and_retry", {
      automatic: false,
      requiresUser: true,
      missingFields: error.missingFields ?? [],
    });
  }
  return error;
}

function buildNextAction(action, { automatic = false, requiresUser = false, missingFields = [], reason } = {}) {
  return {
    action,
    automatic,
    requires_user: requiresUser,
    missing_fields: missingFields,
    ...(reason && { reason }),
  };
}

function candidatesFrom(tools) {
  return tools.slice(0, 10).map((tool) => ({
    tool_id: tool.tool_id,
    ...(tool.name && { name: tool.name }),
    ...(tool.provider_id && { provider_id: tool.provider_id }),
    ...(tool.provider_name && { provider_name: tool.provider_name }),
    ...(tool.expected_cost !== undefined && { expected_cost: tool.expected_cost }),
  }));
}

function decorateFailure(error, metadata = {}) {
  if (!(error instanceof Error)) return error;
  if (error.retryable === undefined) error.retryable = metadata.retryable ?? false;
  if (error.action === undefined) error.action = metadata.action ?? "review_and_retry";
  if (error.missingFields === undefined) error.missingFields = metadata.missingFields ?? [];
  if (error.fallbackAvailable === undefined) error.fallbackAvailable = metadata.fallbackAvailable ?? false;
  if (error.candidates === undefined && metadata.candidates) error.candidates = metadata.candidates;
  if (error.nextAction === undefined) {
    error.nextAction =
      metadata.nextAction ??
      buildNextAction(error.action, {
        automatic: false,
        requiresUser: !error.retryable,
        missingFields: error.missingFields,
      });
  }
  return error;
}

function boundaryActionFor(code) {
  return {
    AUTH_INVALID_KEY: "authenticate",
    AUTH_OAUTH_FAILED: "authenticate",
    PERMISSION_DENIED: "request_permission",
    CREDITS_INSUFFICIENT: "add_credits",
  }[code];
}

function assertContextBudgetSupported(value) {
  if (value === undefined) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw contextError("CONTEXT_INVALID", "--max-credits must be a non-negative number", {
      action: "correct_budget_policy",
      missingFields: ["max_credits"],
    });
  }
  throw contextError("CONTEXT_BUDGET_UNSUPPORTED", "--max-credits cannot be enforced for an exact-tool context call", {
    action: "use_server_enforced_capability_budget_or_remove_budget_cap",
  });
}

function assertExecutionPolicy(tool, flags) {
  const warnings = [];
  const deniedRegions = String(flags.denyRegion ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const region = typeof tool.region === "string" ? tool.region.toUpperCase() : "";
  if (deniedRegions.some((item) => region.split("|").includes(item))) {
    throw contextError("CONTEXT_EXECUTION_BLOCKED", "Tool is prohibited by the requested region policy", {
      action: "select_allowed_provider",
    });
  }
  if (tool.permission_required === true && tool.permission_granted !== true) {
    throw contextError("PERMISSION_DENIED", "Current discovery does not confirm the required permission", {
      action: "grant_permission_or_select_provider",
    });
  }
  if (tool.region_prohibited === true || tool.region_allowed === false) {
    throw contextError("CONTEXT_EXECUTION_BLOCKED", "Current discovery reports a regional prohibition", {
      action: "select_allowed_provider",
    });
  }
  const hasSideEffectMetadata =
    typeof tool.dangerous_side_effects === "boolean" ||
    (typeof tool.side_effects === "string" && tool.side_effects.trim().length > 0);
  const dangerous =
    tool.dangerous_side_effects === true ||
    (typeof tool.side_effects === "string" && !["none", "read_only", "read-only"].includes(tool.side_effects));
  if (dangerous && !flags.allowSideEffects) {
    throw contextError("CONTEXT_EXECUTION_BLOCKED", "Dangerous side effects require explicit confirmation", {
      action: "rerun_with_allow_side_effects",
    });
  }
  if (tool.idempotent === false && !flags.allowNonIdempotent) {
    throw contextError("CONTEXT_EXECUTION_BLOCKED", "Non-idempotent execution requires explicit confirmation", {
      action: "rerun_with_allow_non_idempotent",
    });
  }
  if (!hasSideEffectMetadata) {
    warnings.push({ code: "SIDE_EFFECT_METADATA_ABSENT", action: "continued_without_explicit_risk_signal" });
  }
  if (typeof tool.idempotent !== "boolean") {
    warnings.push({ code: "IDEMPOTENCY_METADATA_ABSENT", action: "paid_call_remains_single_submit" });
  }
  return warnings;
}

async function discoverContextCandidates({ apiKey, credentialProvider, baseUrl, context, timeoutMs }) {
  return discoverTools({
    apiKey,
    credentialProvider,
    baseUrl,
    query: [context.taskId, context.serviceId].filter(Boolean).join(" "),
    limit: 100,
    timeoutMs,
  });
}

async function resolveCurrentContextTool({
  apiKey,
  credentialProvider,
  baseUrl,
  context,
  parameters,
  timeoutMs,
  flags,
}) {
  let discovery;
  try {
    discovery = await discoverTools({
      apiKey,
      credentialProvider,
      baseUrl,
      query: buildContextDiscoveryQuery(context),
      limit: 100,
      timeoutMs,
    });
  } catch (error) {
    if (
      error instanceof CliError &&
      ["AUTH_INVALID_KEY", "AUTH_OAUTH_FAILED", "PERMISSION_DENIED", "CREDITS_INSUFFICIENT"].includes(error.code)
    ) {
      throw decorateFailure(error, { action: boundaryActionFor(error.code) });
    }
    const wrapped = contextError("CONTEXT_REDISCOVERY_FAILED", "Current discovery failed before execution", {
      retryable: true,
      action: "rediscover",
    });
    wrapped.cause = error;
    throw wrapped;
  }

  if (typeof discovery?.search_id !== "string" || discovery.search_id.length === 0) {
    throw contextError("CONTEXT_REDISCOVERY_FAILED", "Current discovery did not return a usable search ID", {
      retryable: true,
      action: "rediscover",
    });
  }

  let discoveryTools = normalizeToolList(discovery);
  if (!discoveryTools) {
    throw contextError("CONTEXT_REDISCOVERY_FAILED", "Current discovery did not return a usable tool list", {
      retryable: true,
      action: "rediscover",
    });
  }
  let discovered = discoveryTools.filter((tool) => tool?.tool_id);
  let candidates = candidatesFrom(discovered);
  if (!context.toolId) {
    return {
      discoveryOnly: true,
      discoveryId: discovery.search_id,
      candidates,
      contextMeta: {
        status: "candidates_refreshed",
        stale_input: context.stale,
        warnings: context.warnings,
        action: "select_tool",
      },
    };
  }
  let selected = discovered.find((tool) => tool.tool_id === context.toolId);
  let fallbackFrom;
  if (!selected) {
    let fallbackDiscovery = discovery;
    let fallbackTools = discovered;
    if (context.serviceId) {
      try {
        fallbackDiscovery = await discoverContextCandidates({
          apiKey,
          credentialProvider,
          baseUrl,
          context,
          timeoutMs,
        });
        const normalizedFallback = normalizeToolList(fallbackDiscovery);
        if (typeof fallbackDiscovery?.search_id !== "string" || !normalizedFallback) {
          throw new Error("malformed fallback discovery");
        }
        fallbackTools = normalizedFallback.filter((tool) => tool?.tool_id);
      } catch (error) {
        if (
          error instanceof CliError &&
          ["AUTH_INVALID_KEY", "AUTH_OAUTH_FAILED", "PERMISSION_DENIED", "CREDITS_INSUFFICIENT"].includes(error.code)
        ) {
          throw decorateFailure(error, { action: boundaryActionFor(error.code) });
        }
        const wrapped = contextError("CONTEXT_REDISCOVERY_FAILED", "Service fallback discovery failed", {
          retryable: true,
          action: "rediscover",
        });
        wrapped.cause = error;
        throw wrapped;
      }
    }
    const sameService = fallbackTools.filter(
      (tool) => typeof tool.service_id === "string" && tool.service_id === context.serviceId,
    );
    if (sameService.length === 1) {
      selected = sameService[0];
      fallbackFrom = context.toolId;
      discovery = fallbackDiscovery;
      discovered = fallbackTools;
      candidates = candidatesFrom(discovered);
    } else {
      candidates = candidatesFrom(fallbackTools);
      throw contextError(
        "CONTEXT_REDISCOVERY_FAILED",
        "The copied tool ID is not present in current discovery results",
        {
          retryable: false,
          action: candidates.length > 0 ? "select_fallback" : "broaden_discovery",
          fallbackAvailable: candidates.length > 0,
          candidates,
        },
      );
    }
  }

  const steps = fallbackFrom ? ["discover", "rediscover_service", "fallback"] : ["discover"];
  let schemaAnalysis = analyzeParameterSchema(selected.params);
  if (!schemaAnalysis.complete) {
    let inspection;
    try {
      inspection = await inspectToolsByIds({
        apiKey,
        credentialProvider,
        baseUrl,
        toolIds: [selected.tool_id],
        discoveryId: discovery.search_id,
        timeoutMs,
      });
    } catch (error) {
      if (
        error instanceof CliError &&
        ["AUTH_INVALID_KEY", "AUTH_OAUTH_FAILED", "PERMISSION_DENIED", "CREDITS_INSUFFICIENT"].includes(error.code)
      ) {
        throw decorateFailure(error, { action: boundaryActionFor(error.code) });
      }
      const wrapped = contextError("CONTEXT_INSPECT_FAILED", "Current inspection failed before execution", {
        retryable: true,
        action: "inspect_again",
      });
      wrapped.cause = error;
      throw wrapped;
    }
    const inspectedTools = normalizeToolList(inspection);
    if (!inspectedTools) {
      throw contextError("CONTEXT_INSPECT_FAILED", "Current inspection did not return a usable tool list", {
        retryable: true,
        action: "inspect_again",
      });
    }
    const inspected = inspectedTools.find((tool) => tool?.tool_id === selected.tool_id);
    if (!inspected) {
      throw contextError("CONTEXT_INSPECT_FAILED", "Current inspection did not confirm the copied tool", {
        retryable: true,
        action: "rediscover",
      });
    }
    selected = { ...selected, ...inspected };
    steps.push("inspect");
    schemaAnalysis = analyzeParameterSchema(selected.params);
  }

  if (schemaAnalysis.complete) {
    const validation = validateParameters(schemaAnalysis.definitions, parameters);
    if (!validation.valid) {
      throw contextError("CONTEXT_PROBE_FAILED", "Parameters do not satisfy the current tool schema", {
        action: "correct_parameters",
        missingFields: validation.missingFields,
        parameterErrors: { unknown: validation.unknown, invalid: validation.invalid },
      });
    }
  }

  const pricing = classifyPricing(selected);
  const quoteRequired = flags.requireQuote || pricing.requiresQuote;
  const checks = [];
  if (!schemaAnalysis.complete) checks.push("schema");
  if (quoteRequired) checks.push("quote");
  let probe;
  if (checks.length > 0) {
    try {
      probe = await probeTool({
        apiKey,
        credentialProvider,
        baseUrl,
        toolId: selected.tool_id,
        parameters,
        checks,
        liveBudget: "none",
        timeoutMs,
      });
    } catch (error) {
      if (
        error instanceof CliError &&
        ["AUTH_INVALID_KEY", "AUTH_OAUTH_FAILED", "PERMISSION_DENIED", "CREDITS_INSUFFICIENT"].includes(error.code)
      ) {
        throw decorateFailure(error, { action: boundaryActionFor(error.code) });
      }
      const wrapped = contextError("CONTEXT_PROBE_FAILED", "Required preflight failed before execution", {
        retryable: true,
        action: "probe_again",
      });
      wrapped.cause = error;
      throw wrapped;
    }
    steps.push("probe");
  }
  if (!schemaAnalysis.complete && probe?.schema?.valid !== true) {
    const violations = Array.isArray(probe?.schema?.violations) ? probe.schema.violations : [];
    throw contextError("CONTEXT_PROBE_FAILED", "Current probe did not validate the supplied parameters", {
      action: "correct_parameters",
      missingFields: violations
        .map((item) => item?.param)
        .filter((param) => typeof param === "string" && param.length > 0),
    });
  }
  const quoteValidation = quoteRequired ? validateQuote(probe?.quote) : null;
  if (quoteValidation && !quoteValidation.valid) {
    throw contextError("CONTEXT_QUOTE_REQUIRED", "Current pricing policy requires a usable quote", {
      retryable: true,
      action: "refresh_quote_or_change_budget_policy",
    });
  }
  const quoteCost = quoteValidation?.amount;

  const executionWarnings = flags.dryRun ? [] : assertExecutionPolicy(selected, flags);

  const warnings = [...context.warnings, ...executionWarnings];
  if (!quoteRequired && pricing.status === "absent") {
    warnings.push({ code: "PRICE_UNKNOWN", action: "continued_by_policy" });
  }
  return {
    toolId: selected.tool_id,
    discoveryId: discovery.search_id,
    fallbackCandidates: candidates.filter((item) => item.tool_id !== selected.tool_id),
    contextMeta: {
      status: "refreshed",
      stale_input: context.stale,
      warnings,
      validation_steps: steps,
      ...(fallbackFrom && { fallback: { from_tool_id: fallbackFrom, to_tool_id: selected.tool_id } }),
      price_status:
        quoteCost !== undefined ? (quoteValidation.exact ? "quoted_exact" : "quoted_estimate") : pricing.status,
    },
  };
}

function outputContextCandidates(current, flags) {
  const result = {
    status: "candidates",
    execution_skipped: true,
    discovery_id: current.discoveryId,
    candidates: current.candidates,
    context_handoff: current.contextMeta,
    next_action: buildNextAction("select_tool", { requiresUser: true }),
  };
  if (flags.json) outputJson(result);
  else {
    console.log(`\n  ${bold("Current candidates")} (${current.discoveryId})`);
    for (const candidate of current.candidates) console.log(`  - ${candidate.tool_id}`);
    console.log(`\n  ${dim("Select an exact tool_id before execution.")}\n`);
  }
  return result;
}

async function executeCall({
  apiKey,
  credentialProvider,
  baseUrl,
  toolId,
  discoveryId,
  parameters,
  maxSize,
  timeoutMs,
  flags,
  contextMeta,
  fallbackCandidates = [],
}) {
  if (flags.dryRun) {
    if (flags.json) {
      outputJson({
        dry_run: true,
        tool_id: toolId,
        discovery_id: discoveryId,
        parameters,
        max_response_size: maxSize,
        ...(flags.respondWith !== undefined && { respond_with: flags.respondWith }),
        ...(flags.model !== undefined && { model: flags.model }),
        ...(contextMeta && { context_handoff: contextMeta }),
      });
    } else {
      console.log(`\n  ${bold("Dry run")} -- would send:\n`);
      console.log(`  Tool:         ${cyan(toolId)}`);
      console.log(`  Discovery ID: ${dim(discoveryId)}`);
      console.log(`  Max size:     ${maxSize}`);
      if (flags.respondWith !== undefined) console.log(`  Respond with: ${flags.respondWith}`);
      if (flags.model !== undefined) console.log(`  Model:        ${flags.model}`);
      console.log(`  Parameters:`);
      console.log(
        JSON.stringify(parameters, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );
    }
    return;
  }

  if (!flags.json && contextMeta?.warnings?.length) {
    for (const warning of contextMeta.warnings) {
      console.error(`  Warning [${warning.code}]: ${warning.action}`);
    }
  }
  const spinner = flags.json ? { stop() {} } : createSpinner("Calling tool...");

  try {
    const result = await callTool({
      apiKey,
      credentialProvider,
      baseUrl,
      toolId,
      discoveryId,
      parameters,
      maxResponseSize: maxSize,
      respondWith: flags.respondWith,
      model: flags.model,
      timeoutMs,
    });

    spinner.stop();

    if (flags.json) {
      const recovery =
        result?.success === false
          ? {
              code: "PROVIDER_FAILURE",
              retryable: true,
              action: result.execution_id
                ? "reconcile_settlement"
                : fallbackCandidates.length > 0
                  ? "select_fallback"
                  : "rediscover",
              missing_fields: [],
              fallback_available: fallbackCandidates.length > 0,
              candidates: fallbackCandidates,
              next_action: buildNextAction(result.execution_id ? "reconcile_settlement" : "rediscover", {
                automatic: false,
                requiresUser: false,
                reason: result.execution_id ? "call_failed_after_submission" : "provider_failure",
              }),
            }
          : undefined;
      outputJson({
        ...result,
        ...(contextMeta && { context_handoff: contextMeta }),
        ...(recovery && { recovery }),
        next_action: buildNextAction(result?.success === true ? "none" : (recovery?.action ?? "review_result")),
      });
    } else {
      console.log(formatCallResult(result));
    }

    if (flags.codegen && result.success) {
      const snippet = generateSnippet(flags.codegen, {
        baseUrl,
        toolId,
        discoveryId,
        parameters,
        maxResponseSize: maxSize,
        respondWith: flags.respondWith,
        model: flags.model,
      });
      console.log(`\n  ${dim("--- Code snippet (" + flags.codegen + ") ---")}\n`);
      console.log(snippet);
      console.log();
    }
  } catch (err) {
    spinner.stop();
    const executionId = err?.responseData?.execution_id;
    if (executionId) {
      const settlement = await reconcileSettlement({
        apiKey,
        credentialProvider,
        baseUrl,
        executionId,
        timeoutMs,
      });
      const settlementFinal = settlement.status === "final";
      const status = settlementFinal ? "settlement_final" : "unknown_settlement";
      const action = settlementFinal ? "review_settlement" : "wait_and_reconcile";
      const reason = settlementFinal ? "settlement_final" : "settlement_not_final";
      const nextAction = buildNextAction(action, {
        automatic: false,
        requiresUser: false,
        reason,
      });
      if (flags.json) {
        const result = {
          success: false,
          status,
          execution_id: executionId,
          ...(contextMeta && { context_handoff: contextMeta }),
          settlement,
          next_action: nextAction,
        };
        outputJson(result);
        process.exitCode = process.exitCode || err.exitCode || 1;
        return result;
      }
      err.action = action;
      err.nextAction = nextAction;
      err.settlement = settlement;
    }
    const boundaryAction = boundaryActionFor(err?.code);
    throw decorateFailure(err, {
      retryable: ["NET_TIMEOUT", "RATE_LIMITED", "PROVIDER_FAILURE", "API_ERROR"].includes(err.code),
      action: boundaryAction ?? (fallbackCandidates.length > 0 ? "select_fallback" : "retry"),
      fallbackAvailable: fallbackCandidates.length > 0,
      candidates: fallbackCandidates,
    });
  }
}

async function reconcileSettlement({ apiKey, credentialProvider, baseUrl, executionId, timeoutMs }) {
  const result = { status: "unknown", usage_checked: false, ledger_checked: false };
  try {
    const usage = unwrapApiResponse(
      await getUsageHistory({
        apiKey,
        credentialProvider,
        baseUrl,
        query: { execution_id: executionId, page: 1, page_size: 20 },
        timeoutMs,
      }),
    );
    result.usage_checked = true;
    result.usage = Array.isArray(usage?.items) ? usage.items.filter((item) => item?.execution_id === executionId) : [];
  } catch (error) {
    result.usage_error = error?.code ?? "AUDIT_UNAVAILABLE";
  }
  try {
    const ledger = unwrapApiResponse(
      await getCreditsLedger({
        apiKey,
        credentialProvider,
        baseUrl,
        query: { page: 1, page_size: 100 },
        timeoutMs,
      }),
    );
    result.ledger_checked = true;
    result.ledger = Array.isArray(ledger?.items)
      ? ledger.items.filter((item) => item?.execution_id === executionId)
      : [];
  } catch (error) {
    result.ledger_error = error?.code ?? "AUDIT_UNAVAILABLE";
  }
  const usageFinal = result.usage?.some((item) =>
    ["charged", "not_charged", "refunded", "settled"].includes(item?.charge_outcome),
  );
  if ((result.ledger?.length ?? 0) > 0 || usageFinal) result.status = "final";
  return result;
}
