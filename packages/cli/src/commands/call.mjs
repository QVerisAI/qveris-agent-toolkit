import { resolveApiKey } from "../client/auth.mjs";
import { callTool } from "../client/api.mjs";
import { resolveToolId, getSessionDiscoveryId } from "../session/session.mjs";
import { resolveParams } from "../utils/params.mjs";
import { formatCallResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { generateSnippet } from "../output/codegen.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";

// Smart max_response_size defaults:
//   --max-size N   → user explicit override (highest priority)
//   --json         → 20480 (agent/LLM scenario, matches MCP server)
//   non-TTY        → 20480 (piped/scripted, likely agent)
//   TTY            → 4096  (human terminal, auto-truncate large results)
const MAX_SIZE_TTY = 4096;
const MAX_SIZE_AGENT = 20480;

function resolveMaxSize(flags) {
  if (flags.maxSize !== undefined) return parseInt(flags.maxSize, 10);
  if (flags.json) return MAX_SIZE_AGENT;
  if (!process.stdout.isTTY) return MAX_SIZE_AGENT;
  return MAX_SIZE_TTY;
}

export async function runCall(idOrIndex, flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 60) * 1000;
  const maxSize = resolveMaxSize(flags);

  const resolved = resolveToolId(idOrIndex);
  const toolId = resolved.toolId;
  let discoveryId = flags.discoveryId || null;

  if (!discoveryId && resolved.fromSession && resolved.discoveryId) {
    discoveryId = resolved.discoveryId;
  }
  if (!discoveryId) discoveryId = getSessionDiscoveryId();
  if (!discoveryId) {
    throw new CliError("SESSION_EXPIRED", "No discovery ID. Run 'qveris discover' first or pass --discovery-id.");
  }

  const parameters = resolveParams(flags.params || "{}");

  if (flags.dryRun) {
    if (flags.json) {
      outputJson({ dry_run: true, tool_id: toolId, discovery_id: discoveryId, parameters, max_response_size: maxSize });
    } else {
      console.log(`\n  ${bold("Dry run")} -- would send:\n`);
      console.log(`  Tool:         ${cyan(toolId)}`);
      console.log(`  Discovery ID: ${dim(discoveryId)}`);
      console.log(`  Max size:     ${maxSize}`);
      console.log(`  Parameters:`);
      console.log(JSON.stringify(parameters, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
    }
    return;
  }

  const spinner = flags.json ? { stop() {} } : createSpinner("Calling tool...");

  try {
    const result = await callTool({
      apiKey,
      baseUrl: flags.baseUrl,
      toolId,
      discoveryId,
      parameters,
      maxResponseSize: maxSize,
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
        toolId,
        discoveryId,
        parameters,
        maxResponseSize: maxSize,
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
