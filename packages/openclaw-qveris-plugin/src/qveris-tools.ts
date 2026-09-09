import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, readPositiveIntegerParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { makeDiscoverCache, makeDiscoverResultTracker, makeToolRolodex } from "./qveris-cache.js";
import {
  resolveAutoMaterialize,
  resolveCapabilityMemoryTtlSeconds,
  resolveCallTimeoutSeconds,
  resolveDiscoverCacheTtlSeconds,
  resolveDiscoverLimit,
  resolveDiscoverTimeoutSeconds,
  resolveFullContentAllowedDomains,
  resolveFullContentMaxBytes,
  resolveFullContentTimeoutSeconds,
  resolveMaxResponseSize,
  resolveQverisApiKey,
  resolveQverisBaseUrl,
  resolveRememberSuccessfulCapabilities,
} from "./config.js";
import { qverisCall, qverisDiscover, qverisInspect } from "./qveris-client.js";
import type { QverisDiscoverResultTool } from "./qveris-client.js";
import { classifyQverisError, QVERIS_WORKFLOW_NOTE } from "./qveris-errors.js";
import type { QverisErrorResult } from "./qveris-errors.js";
import { saveQverisFullResult } from "./qveris-materialization.js";

// ============================================================================
// Tool Schemas
// ============================================================================

const QverisDiscoverSchema = Type.Object(
  {
    query: Type.String({
      description:
        "English API capability description. Describe the type of tool, not your task or question. " +
        "GOOD: 'stock quote real-time API', 'stock historical price time series API', 'web page content extraction API'. " +
        "BAD: 'what is the weather in Beijing' (question), 'AAPL stock price today' (task). " +
        "Chinese input should also produce English capability: '腾讯最新股价' -> 'stock quote real-time API'.",
    }),
    limit: Type.Optional(
      Type.Integer({
        description: "Maximum number of results to return (1-100). Default: 10.",
        minimum: 1,
        maximum: 100,
      }),
    ),
    refresh: Type.Optional(
      Type.Boolean({
        description:
          "Bypass the session's short-lived exact-query cache and fetch current discovery results. Default: false.",
      }),
    ),
    clear_capability_memory: Type.Optional(
      Type.Boolean({
        description:
          "Forget successful-capability hints for this exact normalized query before returning results. Default: false.",
      }),
    ),
  },
  { additionalProperties: false },
);

const QverisCallSchema = Type.Object(
  {
    tool_id: Type.String({
      description: "The tool_id from qveris_discover or qveris_inspect results.",
    }),
    params_to_tool: Type.String({
      description:
        "JSON dictionary of parameters to pass to the tool. " +
        "Use the current params contract from qveris_discover or qveris_inspect. Samples describe shape only; derive business values from the current request. " +
        "Common mistakes to avoid: " +
        '(1) numbers must be unquoted (limit: 10, not "10"); ' +
        "(2) dates must be ISO 8601 (2025-01-15, not 01/15/2025); " +
        '(3) use identifiers not natural language (symbol: "AAPL", not "Apple stock price"); ' +
        "(4) never omit required params listed in the discovery results. " +
        'Example: \'{"city": "London", "units": "metric"}\'.',
    }),
    max_response_size: Type.Optional(
      Type.Integer({
        description:
          "Maximum size of response data in bytes. If tool generates data longer than this, it will be truncated. Default: 20480 (20KB).",
        minimum: 1,
      }),
    ),
    timeout_seconds: Type.Optional(
      Type.Integer({
        description:
          "Override timeout in seconds for this invocation. Default: 60s. For long-running tasks (image/video generation, multimodal processing) set 60-120s; only lower if you are certain the tool is fast.",
        minimum: 1,
        maximum: 300,
      }),
    ),
  },
  { additionalProperties: false },
);

const QverisInspectSchema = Type.Object(
  {
    tool_ids: Type.String({
      description:
        "Comma-separated list of QVeris tool IDs to inspect (e.g. 'jina_ai.reader.execute.v1.b2ef8fda,openweathermap.weather.execute.v1'). " +
        "Use tool IDs from a previous qveris_discover or from session context to verify availability and get current parameter schemas.",
    }),
  },
  { additionalProperties: false },
);

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Creates the three QVeris agent tools (discover, call, inspect).
 * Returns null when QVeris is disabled (no API key configured).
 * All session-scoped state is contained in the returned closures.
 */
export function createQverisTools(options: {
  api: OpenClawPluginApi;
  ctx: OpenClawPluginToolContext;
}): AnyAgentTool[] | null {
  const { api, ctx } = options;
  const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;

  const apiKey = resolveQverisApiKey(pluginConfig);
  if (!apiKey) {
    return null;
  }

  const baseUrl = resolveQverisBaseUrl(pluginConfig);
  const discoverTimeoutSeconds = resolveDiscoverTimeoutSeconds(pluginConfig);
  const callTimeoutSeconds = resolveCallTimeoutSeconds(pluginConfig);
  const maxResponseSize = resolveMaxResponseSize(pluginConfig);
  const discoverLimit = resolveDiscoverLimit(pluginConfig);
  const discoverCacheTtlMs = resolveDiscoverCacheTtlSeconds(pluginConfig) * 1000;
  const capabilityMemoryTtlMs = resolveCapabilityMemoryTtlSeconds(pluginConfig) * 1000;
  const rememberSuccessfulCapabilities = resolveRememberSuccessfulCapabilities(pluginConfig);
  const autoMaterialize = resolveAutoMaterialize(pluginConfig);
  const fullContentMaxBytes = resolveFullContentMaxBytes(pluginConfig);
  const fullContentTimeoutSeconds = resolveFullContentTimeoutSeconds(pluginConfig);
  const workspaceDir = ctx.workspaceDir?.trim() || undefined;

  // Session-scoped state — shared across all 3 tools since they are created together
  const discoverCache = makeDiscoverCache<Awaited<ReturnType<typeof qverisDiscover>>>();
  const rolodex = makeToolRolodex({
    ttlMs: capabilityMemoryTtlMs,
    enabled: rememberSuccessfulCapabilities,
  });
  // Correlation state is separate from optional success-memory hints. It keeps
  // the backend search_id available for the normal discover -> call handoff.
  const discoverTracker = makeDiscoverResultTracker({ ttlMs: 30 * 60 * 1000 });
  const callFailureCount = new Map<string, number>();

  const sessionId = ctx.sessionKey ?? `qveris-${Date.now()}-${randomUUID()}`;

  // Auto-resolve the backend search_id so the model never has to manage it
  function resolveKnownSearchId(toolId: string): string | undefined {
    return discoverTracker.getMeta(toolId)?.searchId ?? rolodex.lookup(toolId)?.discoveryId;
  }

  function formatToolForModel(tool: QverisDiscoverResultTool, discoveryQuery?: string) {
    const entry = rolodex.lookup(tool.tool_id, discoveryQuery);
    return {
      tool_id: tool.tool_id,
      name: tool.name,
      description: tool.description,
      provider_description: tool.provider_description,
      params: tool.params?.map((p) => ({
        ...p,
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description?.en ?? Object.values(p.description ?? {})[0],
      })),
      examples: tool.examples?.sample_parameters ? { sample_parameters: tool.examples.sample_parameters } : undefined,
      stats: tool.stats,
      why_recommended: tool.why_recommended,
      expected_cost: tool.expected_cost,
      ...(entry ? { previously_used: true, session_uses: entry.successCount } : {}),
    };
  }

  // ---- qveris_discover ----

  const discoverTool: AnyAgentTool = {
    label: "QVeris Discover",
    name: "qveris_discover",
    description:
      "Find specialized API tools for exact current values, historical sequence data, structured reports, " +
      "web extraction/crawling, PDF workflows, or external service capabilities " +
      "(OCR, speech, image/video understanding or generation, translation, geocoding). " +
      "Use when task fit, data quality/freshness, provider comparison, fallback, or an explicit user request favors QVeris. " +
      "Provider comparison: Inspect each candidate to confirm current scope/contracts. If current quotes are required, do not Call until the host obtains them; this three-tool plugin does not expose Probe. " +
      "NOT for local file operations or software documentation. Do not use as a mandatory gateway when another connected tool better satisfies the request. " +
      "Query must describe the API capability in English.",
    parameters: QverisDiscoverSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limit = readPositiveIntegerParam(params, "limit") ?? discoverLimit;
      const normalizedLimit = Math.min(Math.max(1, limit), 100);
      const refresh = params.refresh === true;
      const clearCapabilityMemory = params.clear_capability_memory === true;

      if (clearCapabilityMemory) rolodex.clear(query);

      const normalizedQuery = query.trim().replace(/\s+/g, " ").toLowerCase();
      const cacheKey = `${normalizedQuery}:${normalizedLimit}`;
      const cached = refresh ? undefined : discoverCache.read(cacheKey);

      let result: Awaited<ReturnType<typeof qverisDiscover>>;
      if (cached) {
        result = cached;
      } else {
        try {
          result = await qverisDiscover({
            query,
            sessionId,
            limit: normalizedLimit,
            apiKey,
            baseUrl,
            timeoutSeconds: discoverTimeoutSeconds,
          });
        } catch (err) {
          return jsonResult(classifyQverisError(err));
        }
        discoverCache.write(cacheKey, result, discoverCacheTtlMs);
      }

      // A cache hit must not extend schema/provenance freshness. Only a fresh
      // network response advances the acquisition timestamp.
      if (!cached) {
        discoverTracker.trackResults(
          query,
          result.results.map((t) => ({
            tool_id: t.tool_id,
            name: t.name,
            description: t.description,
            params: t.params,
          })),
          result.search_id,
        );
        for (const tool of result.results) {
          const meta = discoverTracker.getMeta(tool.tool_id);
          if (!meta) continue;
          rolodex.reconcileFreshDiscovery(tool.tool_id, {
            name: meta.name,
            description: meta.description,
            discoveryQuery: meta.query,
            discoveryId: meta.searchId,
            parameterContract: meta.parameterContract,
            contractExpiresAt: meta.expiresAt,
            metadataSource: meta.metadataSource,
          });
        }
      }

      const knownTools = rolodex.getSummary(query);
      const payload = jsonResult({
        query: result.query,
        total: result.total,
        elapsed_time_ms: result.elapsed_time_ms,
        results: result.results.map((tool) => formatToolForModel(tool, query)),
        discovery_cache: {
          hit: Boolean(cached),
          scope: "session",
          match: "normalized_exact_query_and_limit",
          refresh_supported: true,
        },
        ...(knownTools.length > 0 ? { session_known_tools: knownTools } : {}),
      });

      return payload;
    },
  };

  // ---- qveris_call ----

  const callTool: AnyAgentTool = {
    label: "QVeris Call",
    name: "qveris_call",
    description:
      "Call a discovered third-party API/service. " +
      "Provide the tool_id from qveris_discover results and parameters as a JSON string in params_to_tool. " +
      "Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data.",
    parameters: QverisCallSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const toolId = readStringParam(params, "tool_id", { required: true });
      const searchId = resolveKnownSearchId(toolId);
      const paramsToToolRaw = readStringParam(params, "params_to_tool", { required: true });
      const maxSize = readPositiveIntegerParam(params, "max_response_size") ?? maxResponseSize;
      const timeoutOverride = readPositiveIntegerParam(params, "timeout_seconds", { max: 300 });

      let toolParams: Record<string, unknown>;
      try {
        const parsed = JSON.parse(paramsToToolRaw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return jsonResult({
            success: false,
            error_type: "json_parse_error",
            detail: "params_to_tool must be a JSON object.",
            retry_hint:
              'Use the current params contract and pass a JSON object such as {"city":"London"}; do not copy stale sample values.',
            note: QVERIS_WORKFLOW_NOTE,
          } satisfies QverisErrorResult);
        }
        toolParams = parsed as Record<string, unknown>;
      } catch (parseError) {
        return jsonResult({
          success: false,
          error_type: "json_parse_error",
          detail: `Invalid JSON in params_to_tool: ${parseError instanceof Error ? parseError.message : "Unknown parse error"}`,
          retry_hint: "Use the current params contract, derive values from this request, and ensure valid JSON.",
          note: QVERIS_WORKFLOW_NOTE,
        } satisfies QverisErrorResult);
      }

      const remembered = rolodex.lookup(toolId);
      const currentMeta = discoverTracker.getMeta(toolId);
      const rememberedContractStale =
        remembered?.contractExpiresAt !== undefined && Date.now() > remembered.contractExpiresAt;
      if (rolodex.isStale(toolId) || rememberedContractStale || (remembered && !currentMeta)) {
        return jsonResult({
          success: false,
          error_type: "tool_not_discovered",
          detail: "The remembered capability route or its parameter contract has expired.",
          retry_hint: "Run qveris_discover again before another paid Call.",
          note: QVERIS_WORKFLOW_NOTE,
        } satisfies QverisErrorResult);
      }
      if (remembered && currentMeta?.parameterContract === undefined) {
        return jsonResult({
          success: false,
          error_type: "tool_not_discovered",
          detail: "The current discovery/inspection projection omitted the parameter contract.",
          retry_hint: "Run qveris_inspect for this tool before Call; an omitted contract is not a zero-parameter tool.",
          note: QVERIS_WORKFLOW_NOTE,
        } satisfies QverisErrorResult);
      }

      let result: Awaited<ReturnType<typeof qverisCall>>;
      try {
        result = await qverisCall({
          toolId,
          searchId,
          sessionId,
          parameters: toolParams,
          maxResponseSize: maxSize,
          apiKey,
          baseUrl,
          timeoutSeconds: timeoutOverride ?? callTimeoutSeconds,
        });
      } catch (err) {
        const classified = classifyQverisError(err, { replaySafe: false });
        if (classified.retry_safe === false) return jsonResult(classified);
        const failCount = (callFailureCount.get(toolId) ?? 0) + 1;
        callFailureCount.set(toolId, failCount);
        const recoveryStep = failCount === 1 ? "fix_params" : failCount === 2 ? "simplify" : "switch_tool";
        return jsonResult({ ...classified, recovery_step: recoveryStep, attempt_number: failCount });
      }

      if (result.success) {
        callFailureCount.delete(toolId);
        const meta = discoverTracker.getMeta(toolId);
        if (meta) {
          rolodex.record(toolId, {
            name: meta.name,
            description: meta.description,
            discoveryQuery: meta.query,
            discoveryId: searchId,
            parameterContract: meta.parameterContract,
            contractExpiresAt: meta.expiresAt,
            metadataSource: meta.metadataSource,
          });
        }
      } else {
        const failCount = (callFailureCount.get(toolId) ?? 0) + 1;
        callFailureCount.set(toolId, failCount);
        const recoveryStep = failCount === 1 ? "fix_params" : failCount === 2 ? "simplify" : "switch_tool";
        return jsonResult({
          execution_id: result.execution_id,
          success: false,
          elapsed_time_ms: result.elapsed_time_ms,
          error_message: result.error_message,
          cost: result.cost ?? result.credits_used,
          recovery_step: recoveryStep,
          attempt_number: failCount,
          note: QVERIS_WORKFLOW_NOTE,
        });
      }

      // result.result is always non-null when success === true (API contract)
      const resultData = result.result ?? {};
      const fullContentUrl =
        typeof resultData?.full_content_file_url === "string" && resultData.full_content_file_url
          ? resultData.full_content_file_url
          : null;
      const isTruncated = Boolean(resultData?.truncated_content || fullContentUrl);

      if (isTruncated && fullContentUrl && autoMaterialize && workspaceDir) {
        const materialized = await saveQverisFullResult({
          url: fullContentUrl,
          executionId: result.execution_id,
          workspaceDir,
          maxBytes: fullContentMaxBytes,
          timeoutSeconds: fullContentTimeoutSeconds,
          allowedDomains: resolveFullContentAllowedDomains(pluginConfig),
        });

        if (materialized.status === "ready") {
          const {
            truncated_content: _tc,
            full_content_file_url: _url,
            ...cleanResult
          } = resultData as Record<string, unknown>;
          return jsonResult({
            execution_id: result.execution_id,
            success: true,
            elapsed_time_ms: result.elapsed_time_ms,
            result: cleanResult,
            cost: result.cost ?? result.credits_used,
            materialized_content: materialized,
          });
        }

        return jsonResult({
          execution_id: result.execution_id,
          success: true,
          elapsed_time_ms: result.elapsed_time_ms,
          result: resultData,
          cost: result.cost ?? result.credits_used,
          truncated: true,
          truncation_hint: "Auto-materialization failed. Use web_fetch on full_content_file_url to download manually.",
          materialized_content: materialized,
        });
      }

      return jsonResult({
        execution_id: result.execution_id,
        success: true,
        elapsed_time_ms: result.elapsed_time_ms,
        result: resultData,
        cost: result.cost ?? result.credits_used,
        ...(isTruncated
          ? {
              truncated: true,
              truncation_hint:
                "Response was truncated. Increase max_response_size for full data, " +
                "or use full_content_file_url if available.",
            }
          : {}),
      });
    },
  };

  // ---- qveris_inspect ----

  const inspectTool: AnyAgentTool = {
    label: "QVeris Inspect",
    name: "qveris_inspect",
    description:
      "Inspect known QVeris tools by their IDs without a full discovery. " +
      "Use when you already have a tool_id from a previous qveris_discover or session context " +
      "and want to verify availability and get current parameter schemas before reusing the tool. " +
      "Provider comparison: Inspect each candidate to confirm current scope/contracts. If current quotes are required, do not Call until the host obtains them; this three-tool plugin does not expose Probe.",
    parameters: QverisInspectSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const toolIdsRaw = readStringParam(params, "tool_ids", { required: true });
      const toolIds = toolIdsRaw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (toolIds.length === 0) {
        return jsonResult({
          success: false,
          error_type: "json_parse_error" as const,
          detail: "No valid tool IDs provided. Pass comma-separated tool IDs.",
          retry_hint: "Example: 'jina_ai.reader.execute.v1.b2ef8fda'",
          note: QVERIS_WORKFLOW_NOTE,
        } satisfies QverisErrorResult);
      }

      let result: Awaited<ReturnType<typeof qverisInspect>>;
      try {
        result = await qverisInspect({
          toolIds,
          sessionId,
          apiKey,
          baseUrl,
          timeoutSeconds: discoverTimeoutSeconds,
        });
      } catch (err) {
        return jsonResult(classifyQverisError(err));
      }

      for (const tool of result.tools) {
        const rememberedContext = rolodex.getStoredContext(tool.tool_id);
        discoverTracker.trackResults(
          rememberedContext?.discoveryQuery ?? "(inspect)",
          [
            {
              tool_id: tool.tool_id,
              name: tool.name,
              description: tool.description,
              params: tool.params,
            },
          ],
          rememberedContext?.discoveryId,
          "inspect",
        );
        const meta = discoverTracker.getMeta(tool.tool_id);
        if (!meta) continue;
        rolodex.reconcileFreshInspection(tool.tool_id, {
          name: meta.name,
          description: meta.description,
          parameterContract: meta.parameterContract,
          contractExpiresAt: meta.expiresAt,
        });
      }

      const tools = result.tools.map((tool) => formatToolForModel(tool));
      const hasSessionContext = tools.some(
        (t) => resolveKnownSearchId((t as { tool_id: string }).tool_id) !== undefined,
      );

      return jsonResult({
        tool_ids_requested: toolIds,
        tools_found: result.tools.length,
        tools,
        ...(!hasSessionContext
          ? {
              call_hint:
                "These tools have not been discovered in this session yet. " +
                "Run qveris_discover first before calling them with qveris_call.",
            }
          : {}),
      });
    },
  };

  return [discoverTool, callTool, inspectTool];
}
