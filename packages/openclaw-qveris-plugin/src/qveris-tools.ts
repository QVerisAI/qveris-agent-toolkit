import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-runtime";
import {
  makeDiscoverCache,
  makeDiscoverResultTracker,
  makeToolRolodex,
} from "./qveris-cache.js";
import {
  resolveAutoMaterialize,
  resolveCallTimeoutSeconds,
  resolveDiscoverLimit,
  resolveDiscoverTimeoutSeconds,
  resolveFullContentAllowedDomains,
  resolveFullContentMaxBytes,
  resolveFullContentTimeoutSeconds,
  resolveMaxResponseSize,
  resolveQverisApiKey,
  resolveQverisBaseUrl,
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
      Type.Number({
        description: "Maximum number of results to return (1-100). Default: 10.",
        minimum: 1,
        maximum: 100,
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
        "IMPORTANT: Use sample_parameters from the qveris_discover results as your template. " +
        "Common mistakes to avoid: " +
        "(1) numbers must be unquoted (limit: 10, not \"10\"); " +
        "(2) dates must be ISO 8601 (2025-01-15, not 01/15/2025); " +
        '(3) use identifiers not natural language (symbol: "AAPL", not "Apple stock price"); ' +
        "(4) never omit required params listed in the discovery results. " +
        'Example: \'{"city": "London", "units": "metric"}\'.',
    }),
    max_response_size: Type.Optional(
      Type.Number({
        description:
          "Maximum size of response data in bytes. If tool generates data longer than this, it will be truncated. Default: 20480 (20KB).",
      }),
    ),
    timeout_seconds: Type.Optional(
      Type.Number({
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
  const autoMaterialize = resolveAutoMaterialize(pluginConfig);
  const fullContentMaxBytes = resolveFullContentMaxBytes(pluginConfig);
  const fullContentTimeoutSeconds = resolveFullContentTimeoutSeconds(pluginConfig);
  const workspaceDir = ctx.workspaceDir?.trim() || undefined;

  // Session-scoped state — shared across all 3 tools since they are created together
  const discoverCache = makeDiscoverCache<ReturnType<typeof jsonResult>>();
  const rolodex = makeToolRolodex();
  const discoverTracker = makeDiscoverResultTracker();
  const callFailureCount = new Map<string, number>();

  const sessionId = ctx.sessionKey ?? `qveris-${Date.now()}-${randomUUID()}`;

  const DEFAULT_DISCOVER_CACHE_TTL_MS = 90_000;

  // Auto-resolve the backend search_id so the model never has to manage it
  function resolveKnownSearchId(toolId: string): string | undefined {
    return rolodex.lookup(toolId)?.discoveryId ?? discoverTracker.getMeta(toolId)?.searchId;
  }

  function formatToolForModel(tool: QverisDiscoverResultTool) {
    const entry = rolodex.lookup(tool.tool_id);
    return {
      tool_id: tool.tool_id,
      name: tool.name,
      description: tool.description,
      provider_description: tool.provider_description,
      params: tool.params?.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description?.en ?? Object.values(p.description ?? {})[0],
      })),
      examples: tool.examples?.sample_parameters
        ? { sample_parameters: tool.examples.sample_parameters }
        : undefined,
      stats: tool.stats,
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
      "Preferred over web_search when a specialized provider can return the answer or perform the work directly. " +
      "NOT for: local file operations, software documentation. " +
      "Query must describe the API capability in English.",
    parameters: QverisDiscoverSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limit = readNumberParam(params, "limit", { integer: true }) ?? discoverLimit;
      const normalizedLimit = Math.min(Math.max(1, limit), 100);

      const cacheKey = `${query}:${normalizedLimit}`;
      const cached = discoverCache.read(cacheKey);
      if (cached) {
        return cached;
      }

      let result: Awaited<ReturnType<typeof qverisDiscover>>;
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

      discoverTracker.trackResults(
        query,
        result.results.map((t) => ({ tool_id: t.tool_id, name: t.name, description: t.description })),
        result.search_id,
      );

      const knownTools = rolodex.getSummary();
      const payload = jsonResult({
        query: result.query,
        total: result.total,
        elapsed_time_ms: result.elapsed_time_ms,
        results: result.results.map(formatToolForModel),
        ...(knownTools.length > 0 ? { session_known_tools: knownTools } : {}),
      });

      discoverCache.write(cacheKey, payload, DEFAULT_DISCOVER_CACHE_TTL_MS);
      return payload;
    },
  };

  // ---- qveris_call ----

  const callTool: AnyAgentTool = {
    label: "QVeris Call",
    name: "qveris_call",
    description:
      "Call a discovered third-party API/service. " +
      "Provide the tool_id from qveris_discover results and parameters as a JSON string in params_to_tool.",
    parameters: QverisCallSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const toolId = readStringParam(params, "tool_id", { required: true });
      const searchId = resolveKnownSearchId(toolId);
      const paramsToToolRaw = readStringParam(params, "params_to_tool", { required: true });
      const maxSize =
        readNumberParam(params, "max_response_size", { integer: true }) ?? maxResponseSize;
      const timeoutOverride = readNumberParam(params, "timeout_seconds");

      let toolParams: Record<string, unknown>;
      try {
        const parsed = JSON.parse(paramsToToolRaw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return jsonResult({
            success: false,
            error_type: "json_parse_error",
            detail: "params_to_tool must be a JSON object.",
            retry_hint:
              "Use sample_parameters from the qveris_discover result as a template and pass a JSON object such as {\"city\":\"London\"}.",
            note: QVERIS_WORKFLOW_NOTE,
          } satisfies QverisErrorResult);
        }
        toolParams = parsed as Record<string, unknown>;
      } catch (parseError) {
        return jsonResult({
          success: false,
          error_type: "json_parse_error",
          detail: `Invalid JSON in params_to_tool: ${parseError instanceof Error ? parseError.message : "Unknown parse error"}`,
          retry_hint:
            "Use sample_parameters from the qveris_discover result as a template and ensure valid JSON.",
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
        const failCount = (callFailureCount.get(toolId) ?? 0) + 1;
        callFailureCount.set(toolId, failCount);
        const recoveryStep =
          failCount === 1 ? "fix_params" : failCount === 2 ? "simplify" : "switch_tool";
        const classified = classifyQverisError(err);
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
          });
        }
      } else {
        const failCount = (callFailureCount.get(toolId) ?? 0) + 1;
        callFailureCount.set(toolId, failCount);
        const recoveryStep =
          failCount === 1 ? "fix_params" : failCount === 2 ? "simplify" : "switch_tool";
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
          truncation_hint:
            "Auto-materialization failed. Use web_fetch on full_content_file_url to download manually.",
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
      "and want to verify availability and get current parameter schemas before reusing the tool.",
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

      discoverTracker.trackResults(
        "(inspect)",
        result.tools.map((t) => ({ tool_id: t.tool_id, name: t.name, description: t.description })),
      );

      const tools = result.tools.map(formatToolForModel);
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
