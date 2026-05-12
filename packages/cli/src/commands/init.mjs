import { resolveApiKey } from "../client/auth.mjs";
import { callTool, discoverTools, inspectToolsByIds } from "../client/api.mjs";
import { resolve } from "../config/resolve.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, cyan, dim, green, red, yellow } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";
import { readSession, writeSession } from "../session/session.mjs";
import { resolveParams } from "../utils/params.mjs";

const DEFAULT_QUERY = "weather forecast API";
const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_RESPONSE_SIZE = 20480;

export async function runInit(queryArg, flags) {
  const steps = [];
  const startedAt = Date.now();

  if (!flags.json) {
    console.log(`\n  ${bold("QVeris init")} ${dim("first-call wizard")}\n`);
  }

  const timeoutMs = (parseInt(flags.timeout, 10) || 60) * 1000;
  const apiKey = getInitApiKey(flags);
  const { region, baseUrl, source: regionSource } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey });
  record(steps, "auth", "ok", "API key resolved", {
    source: resolve("api_key", flags.apiKey || flags.token).source,
    key: maskKey(apiKey),
    region,
    base_url: baseUrl,
    region_source: regionSource,
  });

  let discovery;
  let discoveryId;
  let selected;
  let candidateTools = [];
  const query = flags.query || queryArg || DEFAULT_QUERY;
  const limit = parseInt(flags.limit, 10) || DEFAULT_LIMIT;
  const maxResponseSize = resolveInitMaxResponseSize(flags);
  const flagParameters = flags.params ? resolveParams(flags.params) : null;

  if (flags.resume) {
    const session = readSession();
    if (!session?.discoveryId || !Array.isArray(session.results) || session.results.length === 0) {
      throw new CliError("SESSION_EXPIRED", "No resumable init session found. Run 'qveris init' without --resume first.");
    }
    discoveryId = session.discoveryId;
    candidateTools = flags.toolId
      ? [{ tool_id: flags.toolId, name: flags.toolId }]
      : session.results;
    discovery = {
      search_id: discoveryId,
      query: session.query,
      results: session.results,
      resumed: true,
    };
    record(steps, "discover", "ok", "Resumed previous discovery session", {
      query: session.query,
      search_id: discoveryId,
    });
  } else {
    record(steps, "discover", "running", `Discovering capabilities for "${query}"`, { query, limit });
    discovery = await discoverTools({ apiKey, baseUrl, query, limit, timeoutMs });
    const results = discovery.results ?? [];
    if (results.length === 0) {
      throw new CliError("TOOL_NOT_FOUND", `No capabilities matched "${query}". Try 'qveris init --query <broader-query>'.`);
    }
    discoveryId = discovery.search_id;
    candidateTools = flags.toolId
      ? [{ tool_id: flags.toolId, name: flags.toolId }]
      : results;
    writeSession({
      discoveryId,
      query,
      region,
      baseUrl,
      results: results.map((t, i) => ({
        index: i + 1,
        tool_id: t.tool_id,
        name: t.name,
        provider_name: t.provider_name,
      })),
    });
    updateLast(steps, "ok", "Discovery completed", {
      query,
      search_id: discoveryId,
      total: discovery.total ?? results.length,
    });
  }

  const candidateToolIds = candidateTools.map((tool) => tool?.tool_id).filter(Boolean);
  if (candidateToolIds.length === 0) {
    throw new CliError("TOOL_NOT_FOUND", "No selectable capabilities were returned.");
  }

  record(
    steps,
    "inspect",
    "running",
    candidateToolIds.length === 1 ? "Inspecting selected capability" : "Inspecting candidate capabilities",
    { tool_ids: candidateToolIds }
  );
  const inspected = await inspectToolsByIds({
    apiKey,
    baseUrl,
    toolIds: candidateToolIds,
    discoveryId,
    timeoutMs,
  });
  const inspectedTools = mergeCandidateTools(candidateTools, normalizeToolList(inspected));
  selected = pickInitTool(inspectedTools, { toolId: flags.toolId, parameters: flagParameters });
  const inspectedTool = pickInspectedTool(inspectedTools, selected.tool_id) || selected;
  updateLast(steps, "ok", "Inspection completed", {
    tool_id: inspectedTool.tool_id || selected.tool_id,
    tool_name: inspectedTool.name || selected.name,
    selected_reason: flagParameters && !flags.toolId ? "params_match" : flags.toolId ? "explicit_tool" : "first_candidate",
    has_sample_parameters: Boolean(getSampleParameters(inspectedTool)),
  });

  const { parameters, source: paramsSource } = getInitParameters(flags, inspectedTool, flagParameters);
  record(steps, "call", flags.dryRun ? "skipped" : "running", flags.dryRun ? "Dry run requested" : "Calling selected capability", {
    tool_id: selected.tool_id,
    params_source: paramsSource,
    max_response_size: maxResponseSize,
  });

  const nextCommands = buildNextCommands({ selected, discoveryId, parameters });

  if (flags.dryRun) {
    const payload = buildPayload({ steps, discovery, inspectedTool, parameters, callResult: null, nextCommands, startedAt, dryRun: true });
    if (flags.json) outputJson(payload);
    else printHumanSummary(payload);
    return;
  }

  const callResult = await callTool({
    apiKey,
    baseUrl,
    toolId: selected.tool_id,
    discoveryId,
    parameters,
    maxResponseSize,
    timeoutMs,
  });

  if (!callResult.success) {
    const code = looksLikeProviderFailure(callResult.error_message) ? "PROVIDER_FAILURE" : "TOOL_CALL_FAILED";
    const err = new CliError(code, callResult.error_message || "The selected capability returned success=false.");
    if (code === "TOOL_CALL_FAILED") {
      err.hint = `Rerun with adjusted params: qveris init --resume --params ${shellSingleQuote(JSON.stringify(parameters))}`;
    }
    throw err;
  }

  updateLast(steps, "ok", "First call succeeded", {
    execution_id: callResult.execution_id,
    elapsed_time_ms: callResult.elapsed_time_ms ?? callResult.execution_time,
  });
  const finalNextCommands = {
    ...nextCommands,
    usage: nextCommands.usage.replace("<execution_id>", callResult.execution_id),
  };
  record(steps, "audit", "ok", "Use usage and ledger commands to reconcile final billing", {
    usage: finalNextCommands.usage,
    ledger: finalNextCommands.ledger,
  });

  const payload = buildPayload({ steps, discovery, inspectedTool, parameters, callResult, nextCommands, startedAt, dryRun: false });
  if (flags.json) outputJson(payload);
  else printHumanSummary(payload);
}

function getInitApiKey(flags) {
  try {
    return resolveApiKey(flags.apiKey || flags.token);
  } catch (err) {
    if (err instanceof CliError && err.code === "AUTH_MISSING_KEY") {
      err.hint = "Run 'qveris login', set QVERIS_API_KEY, or pass --api-key/--token to qveris init.";
    }
    throw err;
  }
}

function getInitParameters(flags, tool, flagParameters = null) {
  if (flags.params) {
    return { parameters: flagParameters ?? resolveParams(flags.params), source: "flag" };
  }

  const sample = getSampleParameters(tool);
  if (sample) {
    return { parameters: sample, source: "example" };
  }

  throw new CliError("INIT_PARAMS_REQUIRED");
}

function getSampleParameters(tool) {
  const examples = tool?.examples;
  if (!examples || typeof examples !== "object") return null;
  if (examples.sample_parameters && typeof examples.sample_parameters === "object") {
    return examples.sample_parameters;
  }
  if (Array.isArray(examples) && examples[0]?.parameters && typeof examples[0].parameters === "object") {
    return examples[0].parameters;
  }
  if (examples.parameters && typeof examples.parameters === "object") {
    return examples.parameters;
  }
  return null;
}

function pickInspectedTool(response, toolId) {
  const list = normalizeToolList(response);
  if (!Array.isArray(list)) return null;
  return (toolId ? list.find((t) => t?.tool_id === toolId) : list[0]) || null;
}

function normalizeToolList(response) {
  if (Array.isArray(response)) return response;
  return response?.results ?? response?.tools ?? [];
}

function mergeCandidateTools(discoveredTools, inspectedTools) {
  const inspectedById = new Map(
    normalizeToolList(inspectedTools)
      .filter((tool) => tool?.tool_id)
      .map((tool) => [tool.tool_id, tool])
  );
  return discoveredTools.map((tool) => ({
    ...tool,
    ...(inspectedById.get(tool.tool_id) ?? {}),
  }));
}

export function pickInitTool(tools, { toolId, parameters } = {}) {
  const list = normalizeToolList(tools).filter((tool) => tool?.tool_id);
  if (toolId) return list.find((tool) => tool.tool_id === toolId) || { tool_id: toolId, name: toolId };
  if (!parameters) return list[0];

  const ranked = list
    .map((tool, index) => ({ tool, index, score: scoreParameterMatch(tool, parameters) }))
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (ranked.length > 0) return ranked[0].tool;

  const err = new CliError("INIT_PARAMS_REQUIRED", "Provided --params do not satisfy any discovered capability.");
  err.hint = `Inspect candidates and retry with matching params: ${summarizeRequiredParams(list)}`;
  throw err;
}

function scoreParameterMatch(tool, parameters) {
  const schema = Array.isArray(tool?.params) ? tool.params : [];
  if (schema.length === 0) return 0;

  const provided = new Set(Object.keys(parameters ?? {}));
  const required = schema.filter((param) => param?.required).map((param) => param.name).filter(Boolean);
  const allNames = schema.map((param) => param?.name).filter(Boolean);
  const missingRequired = required.filter((name) => !provided.has(name));
  if (missingRequired.length > 0) return Number.NEGATIVE_INFINITY;

  const overlap = allNames.filter((name) => provided.has(name)).length;
  if (overlap === 0 && required.length > 0) return Number.NEGATIVE_INFINITY;
  return required.length * 10 + overlap;
}

function summarizeRequiredParams(tools) {
  return tools.slice(0, 5).map((tool, index) => {
    const required = (Array.isArray(tool?.params) ? tool.params : [])
      .filter((param) => param?.required)
      .map((param) => param.name)
      .filter(Boolean);
    return `${index + 1}. ${tool.tool_id}: ${required.length ? required.join(", ") : "no required params"}`;
  }).join("; ");
}

export function resolveInitMaxResponseSize(flags) {
  if (flags.maxSize === undefined) return DEFAULT_MAX_RESPONSE_SIZE;
  const parsed = parseInt(flags.maxSize, 10);
  if (!Number.isFinite(parsed)) throw new CliError("API_ERROR", "Invalid --max-size: must be an integer");
  return parsed;
}

export function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function buildNextCommands({ selected, discoveryId, parameters }) {
  const paramsJson = shellSingleQuote(JSON.stringify(parameters));
  const executionPlaceholder = "<execution_id>";
  return {
    retry: `qveris call ${selected.tool_id} --discovery-id ${discoveryId} --params ${paramsJson}`,
    usage: `qveris usage --mode search --execution-id ${executionPlaceholder}`,
    ledger: "qveris ledger --mode summary",
  };
}

function buildPayload({ steps, discovery, inspectedTool, parameters, callResult, nextCommands, startedAt, dryRun }) {
  return {
    ok: dryRun ? true : Boolean(callResult?.success),
    dry_run: dryRun,
    elapsed_ms: Date.now() - startedAt,
    steps,
    discovery: {
      query: discovery?.query,
      search_id: discovery?.search_id,
      total: discovery?.total ?? discovery?.results?.length,
    },
    selected_tool: {
      tool_id: inspectedTool?.tool_id,
      name: inspectedTool?.name,
      provider_name: inspectedTool?.provider_name,
    },
    parameters,
    call: callResult ? {
      success: callResult.success,
      execution_id: callResult.execution_id,
      elapsed_time_ms: callResult.elapsed_time_ms ?? callResult.execution_time,
      billing: callResult.billing ?? callResult.pre_settlement_bill,
    } : null,
    next_commands: callResult?.execution_id
      ? { ...nextCommands, usage: nextCommands.usage.replace("<execution_id>", callResult.execution_id) }
      : nextCommands,
  };
}

function record(steps, name, status, message, data = {}) {
  steps.push({ name, status, message, ...data });
}

function updateLast(steps, status, message, data = {}) {
  const last = steps[steps.length - 1];
  Object.assign(last, { status, message }, data);
}

function printHumanSummary(payload) {
  for (let i = 0; i < payload.steps.length; i++) {
    const step = payload.steps[i];
    const icon = step.status === "ok" ? green("\u2713") : step.status === "skipped" ? yellow("!") : red("\u2718");
    console.log(`  ${icon} ${i + 1}/5 ${bold(step.name)} ${dim(step.message)}`);
    if (step.name === "auth") {
      console.log(`      ${dim("key")} ${step.key}  ${dim("region")} ${step.region}  ${dim(step.base_url)}`);
    }
    if (step.name === "discover") {
      console.log(`      ${dim("search_id")} ${step.search_id || payload.discovery.search_id}`);
    }
    if (step.name === "inspect" && step.tool_id) {
      console.log(`      ${dim("selected")} ${cyan(step.tool_id)}`);
    }
    if (step.name === "call" && step.execution_id) {
      console.log(`      ${dim("execution_id")} ${step.execution_id}`);
    }
  }

  console.log(`\n  ${green("First-call path complete.")}`);
  if (payload.dry_run) {
    console.log(`  ${yellow("Dry run only:")} remove --dry-run to perform the call.`);
  }
  if (payload.call?.execution_id) {
    console.log(`\n  ${bold("Reconcile final billing:")}`);
    console.log(`    ${cyan(payload.next_commands.usage)}`);
    console.log(`    ${cyan(payload.next_commands.ledger)}`);
  }
  console.log(`\n  ${dim("Retry selected capability:")}`);
  console.log(`    ${cyan(payload.next_commands.retry)}\n`);
}

function maskKey(key) {
  if (!key) return "none";
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function looksLikeProviderFailure(message = "") {
  const text = String(message).toLowerCase();
  return text.includes("provider") || text.includes("upstream") || text.includes("third-party");
}
