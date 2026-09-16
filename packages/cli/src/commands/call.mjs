import {
  createAuthorizationContextCredentialProvider,
  resolveApiKey,
  resolveAuthorizationContextId,
} from "../client/auth.mjs";
import { callTool, discoverTools, inspectToolsByIds, probeTool, resolveApiBaseUrl } from "../client/api.mjs";
import { resolveToolId, getSessionDiscoveryId, readSessionForContext } from "../session/session.mjs";
import { resolveParams } from "../utils/params.mjs";
import { formatCallResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { generateSnippet } from "../output/codegen.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";
import {
  assertInstallContextCurrent,
  buildContextDiscoveryQuery,
  resolveInstallContext,
} from "../utils/install-context.mjs";

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
    });
    // Re-check after network preflight so a context that expires during
    // Discover/Inspect/Probe is never used to authorize a later Call.
    assertInstallContextCurrent(installContext);
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
  return response?.results ?? response?.tools ?? [];
}

function matchesService(tool, serviceId) {
  if (!serviceId) return true;
  const currentServiceId = tool?.service_id ?? tool?.serviceId;
  return currentServiceId === undefined || currentServiceId === serviceId;
}

async function resolveCurrentContextTool({ apiKey, credentialProvider, baseUrl, context, parameters, timeoutMs }) {
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
      throw error;
    }
    const wrapped = new CliError("CONTEXT_REDISCOVERY_FAILED", "Current discovery failed before execution");
    wrapped.cause = error;
    throw wrapped;
  }

  if (typeof discovery?.search_id !== "string" || discovery.search_id.length === 0) {
    throw new CliError("CONTEXT_REDISCOVERY_FAILED", "Current discovery did not return a usable search ID");
  }

  const discovered = normalizeToolList(discovery).filter(
    (tool) => tool?.tool_id && matchesService(tool, context.serviceId),
  );
  let selected;
  if (context.toolId) {
    selected = discovered.find((tool) => tool.tool_id === context.toolId);
  } else {
    const serviceMatches = discovered.filter((tool) => (tool.service_id ?? tool.serviceId) === context.serviceId);
    if (serviceMatches.length === 1) selected = serviceMatches[0];
  }
  if (!selected) {
    throw new CliError(
      "CONTEXT_REDISCOVERY_FAILED",
      context.toolId
        ? "The copied tool ID is not present in current discovery results"
        : "Current discovery did not resolve the copied service ID to exactly one tool",
    );
  }

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
      throw error;
    }
    const wrapped = new CliError("CONTEXT_INSPECT_FAILED", "Current inspection failed before execution");
    wrapped.cause = error;
    throw wrapped;
  }
  const inspected = normalizeToolList(inspection).find(
    (tool) => tool?.tool_id === selected.tool_id && matchesService(tool, context.serviceId),
  );
  if (!inspected) {
    throw new CliError(
      "CONTEXT_INSPECT_FAILED",
      "Current inspection did not confirm the copied tool and service selection",
    );
  }

  let probe;
  try {
    probe = await probeTool({
      apiKey,
      credentialProvider,
      baseUrl,
      toolId: selected.tool_id,
      parameters,
      checks: ["schema", "quote"],
      liveBudget: "none",
      timeoutMs,
    });
  } catch (error) {
    if (
      error instanceof CliError &&
      ["AUTH_INVALID_KEY", "AUTH_OAUTH_FAILED", "PERMISSION_DENIED", "CREDITS_INSUFFICIENT"].includes(error.code)
    ) {
      throw error;
    }
    const wrapped = new CliError("CONTEXT_PROBE_FAILED", "Current schema/quote probe failed before execution");
    wrapped.cause = error;
    throw wrapped;
  }
  if (probe?.schema?.valid !== true || probe?.valid === false) {
    throw new CliError("CONTEXT_PROBE_FAILED", "Current probe rejected the supplied parameters");
  }

  return { toolId: selected.tool_id, discoveryId: discovery.search_id };
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
      outputJson(result);
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
    throw err;
  }
}
