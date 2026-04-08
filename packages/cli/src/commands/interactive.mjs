import { createInterface } from "node:readline";
import { resolveApiKey } from "../client/auth.mjs";
import { discoverTools, inspectToolsByIds, callTool } from "../client/api.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { resolveParams } from "../utils/params.mjs";
import { formatDiscoverResult, formatInspectResult, formatCallResult } from "../output/formatter.mjs";
import { generateSnippet } from "../output/codegen.mjs";
import { writeSession } from "../session/session.mjs";
import { VERSION } from "../config/defaults.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";
import { printWelcomeBanner } from "../output/banner.mjs";
import { handleError } from "../errors/handler.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runInteractive(flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const baseUrl = flags.baseUrl;
  const { region, baseUrl: resolvedBaseUrl } = resolveBaseUrl({ baseUrlFlag: baseUrl, apiKey });
  const limit = parseInt(flags.limit, 10) || 5;
  const discoverTimeout = (parseInt(flags.timeout, 10) || 30) * 1000;
  const callTimeout = (parseInt(flags.timeout, 10) || 60) * 1000;

  const state = {
    discoveryId: null,
    results: [],
    lastCallContext: null,
  };

  if (!flags.json) {
    printWelcomeBanner({ version: VERSION, noColor: flags.noColor, compact: true });
  }

  console.log(`  ${bold("QVeris Interactive Mode")}`);
  console.log(`  ${dim("Type 'help' for commands, 'exit' to quit.")}\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${cyan("qveris")}${dim(">")} `,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    rl.pause(); // Prevent race conditions on rapid input

    const parts = parseArgs(input);
    const cmd = parts[0]?.toLowerCase();
    const rest = parts.slice(1);

    try {
      switch (cmd) {
        case "discover":
        case "search": {
          const query = rest.join(" ");
          if (!query) { console.log("  Usage: discover <query>"); break; }
          const sp = createSpinner("Discovering...");
          const result = await discoverTools({ apiKey, baseUrl, query, limit, timeoutMs: discoverTimeout });
          sp.stop();
          state.discoveryId = result.search_id;
          state.results = (result.results ?? []).map((t, i) => ({
            index: i + 1, tool_id: t.tool_id, name: t.name, provider_name: t.provider_name,
          }));
          // Persist session so index shortcuts work in subsequent non-interactive calls
          writeSession({ discoveryId: result.search_id, query, region, baseUrl: resolvedBaseUrl, results: state.results });
          console.log(formatDiscoverResult(result));
          break;
        }
        case "inspect": {
          const toolId = resolveId(rest[0], state);
          if (!toolId) { console.log("  Usage: inspect <index|tool_id>"); break; }
          const sp2 = createSpinner("Inspecting...");
          const result = await inspectToolsByIds({ apiKey, baseUrl, toolIds: [toolId], discoveryId: state.discoveryId, timeoutMs: discoverTimeout });
          sp2.stop();
          console.log(formatInspectResult(result));
          break;
        }
        case "call": {
          const toolId = resolveId(rest[0], state);
          if (!toolId) { console.log("  Usage: call <index|tool_id> <json_params>"); break; }
          if (!state.discoveryId) { console.log("  Run 'discover' first."); break; }
          const paramsStr = rest.slice(1).join(" ") || "{}";
          const parameters = resolveParams(paramsStr);
          const sp3 = createSpinner("Calling...");
          const result = await callTool({ apiKey, baseUrl, toolId, discoveryId: state.discoveryId, parameters, timeoutMs: callTimeout });
          sp3.stop();
          console.log(formatCallResult(result));
          if (result.success) {
            state.lastCallContext = { toolId, discoveryId: state.discoveryId, parameters };
          }
          break;
        }
        case "codegen": {
          if (!state.lastCallContext) { console.log("  No successful call yet."); break; }
          const lang = rest[0] || "curl";
          console.log(`\n${generateSnippet(lang, state.lastCallContext)}\n`);
          break;
        }
        case "history": {
          if (!state.discoveryId) { console.log("  No session."); break; }
          console.log(`\n  Discovery ID: ${dim(state.discoveryId)}`);
          for (const r of state.results) {
            console.log(`    ${dim(String(r.index))}  ${cyan(r.tool_id)}`);
          }
          console.log();
          break;
        }
        case "help":
          printHelp();
          break;
        case "exit":
        case "quit":
          rl.close();
          return;
        default:
          console.log(`  Unknown command: ${cmd}. Type 'help' for commands.`);
      }
    } catch (err) {
      handleError(err, false);
    } finally {
      rl.resume();
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log(`\n  ${dim("Bye.")}\n`);
  });
}

function resolveId(raw, state) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const index = parseInt(raw, 10) - 1;
    if (index >= 0 && index < state.results.length) {
      return state.results[index].tool_id;
    }
  }
  return raw;
}

/** Shell-style argument splitting: handles double quotes, single quotes, and backslash escapes. */
function parseArgs(input) {
  const args = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let escape = false;

  for (const ch of input) {
    if (escape) { current += ch; escape = false; continue; }
    if (ch === "\\" && !inSingle) { escape = true; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current) { args.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

function printHelp() {
  console.log(`
  ${bold("Commands:")}
    discover <query>             Find capabilities
    inspect  <index|tool_id>     View tool details
    call     <index|tool_id> {}  Execute a tool with JSON params
    codegen  <curl|js|python>    Generate code from last call
    history                      Show session state
    help                         Show this help
    exit                         Quit
`);
}
