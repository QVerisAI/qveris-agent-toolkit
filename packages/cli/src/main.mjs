import { normalizeLegacyArgs } from "./compat/aliases.mjs";
import { handleError } from "./errors/handler.mjs";
import { VERSION } from "./config/defaults.mjs";
import { bold, dim, cyan } from "./output/colors.mjs";
import { printWelcomeBanner } from "./output/banner.mjs";

export async function main(argv) {
  const rawArgs = argv.slice(2);
  const { args, warnings } = normalizeLegacyArgs(rawArgs);

  for (const w of warnings) {
    console.error(`  ${dim("Deprecated:")} ${w}`);
  }

  const flags = extractGlobalFlags(args);
  if (flags.noColor) {
    process.env.NO_COLOR = "1";
  }

  const positional = flags._positional;
  const command = positional[0];
  const rest = positional.slice(1);

  if (flags.version) {
    console.log(`qveris/${VERSION}`);
    return;
  }

  if (!command || flags.help) {
    printUsage(flags);
    return;
  }

  try {
    switch (command) {
      case "discover": {
        const query = rest.join(" ");
        if (!query) { console.error("  Usage: qveris discover <query>"); process.exitCode = 2; return; }
        const { runDiscover } = await import("./commands/discover.mjs");
        await runDiscover(query, flags);
        break;
      }
      case "inspect": {
        if (rest.length === 0) { console.error("  Usage: qveris inspect <tool_id|index> [...]"); process.exitCode = 2; return; }
        const { runInspect } = await import("./commands/inspect.mjs");
        await runInspect(rest, flags);
        break;
      }
      case "call": {
        if (rest.length === 0) { console.error("  Usage: qveris call <tool_id|index> [--params <json>]"); process.exitCode = 2; return; }
        const { runCall } = await import("./commands/call.mjs");
        await runCall(rest[0], flags);
        break;
      }
      case "init": {
        const { runInit } = await import("./commands/init.mjs");
        await runInit(rest.join(" "), flags);
        break;
      }
      case "login": {
        const { runLogin } = await import("./commands/login.mjs");
        await runLogin(flags);
        break;
      }
      case "logout": {
        const { runLogout } = await import("./commands/login.mjs");
        await runLogout();
        break;
      }
      case "whoami": {
        const { runWhoami } = await import("./commands/login.mjs");
        await runWhoami(flags);
        break;
      }
      case "credits": {
        const { runCredits } = await import("./commands/credits.mjs");
        await runCredits(flags);
        break;
      }
      case "usage": {
        const { runUsage } = await import("./commands/usage.mjs");
        await runUsage(flags);
        break;
      }
      case "ledger": {
        const { runLedger } = await import("./commands/ledger.mjs");
        await runLedger(flags);
        break;
      }
      case "config": {
        const subcommand = rest[0];
        const subArgs = rest.slice(1);
        if (!subcommand) { console.error("  Usage: qveris config <set|get|list|reset|path>"); process.exitCode = 2; return; }
        const { runConfig } = await import("./commands/config.mjs");
        await runConfig(subcommand, subArgs, flags);
        break;
      }
      case "mcp": {
        const subcommand = rest[0];
        const subArgs = rest.slice(1);
        if (!subcommand) { console.error("  Usage: qveris mcp <configure|validate> [target]"); process.exitCode = 2; return; }
        const { runMcp } = await import("./commands/mcp.mjs");
        await runMcp(subcommand, subArgs, flags);
        break;
      }
      case "interactive":
      case "repl": {
        const { runInteractive } = await import("./commands/interactive.mjs");
        await runInteractive(flags);
        break;
      }
      case "doctor": {
        const { runDoctor } = await import("./commands/doctor.mjs");
        await runDoctor(flags);
        break;
      }
      case "history": {
        const { runHistory } = await import("./commands/history.mjs");
        await runHistory(flags);
        break;
      }
      case "completions": {
        const { runCompletions } = await import("./commands/completions.mjs");
        await runCompletions(rest[0]);
        break;
      }
      default:
        console.error(`  Unknown command: ${command}`);
        console.error(`  Run ${cyan("qveris --help")} for available commands.`);
        process.exitCode = 2;
    }
  } catch (err) {
    handleError(err, flags.json);
  }
}

// Boolean short flags: -j, -v, -V, -h
const SHORT_BOOLS = { j: "json", v: "verbose", V: "version", h: "help" };

// --key=value long flag mapping (flag name -> flags property)
const VALUE_FLAGS = {
  "api-key": "apiKey", "base-url": "baseUrl", timeout: "timeout",
  limit: "limit", "discovery-id": "discoveryId", params: "params",
  "max-size": "maxSize", codegen: "codegen", token: "token",
  query: "query", "tool-id": "toolId", target: "target", output: "output",
  mode: "mode", "start-date": "startDate", "end-date": "endDate",
  bucket: "bucket", "execution-id": "executionId", "search-id": "searchId",
  "event-type": "eventType", kind: "kind", success: "success",
  "charge-outcome": "chargeOutcome", "entry-type": "entryType",
  direction: "direction", "min-credits": "minCredits", "max-credits": "maxCredits",
};

function takeNext(args, i, flag) {
  const next = args[i + 1];
  if (next === undefined || next.startsWith("--")) {
    console.error(`  Error: ${flag} requires a value`);
    process.exitCode = 2;
    return undefined;
  }
  return next;
}

function extractGlobalFlags(args) {
  const flags = { _positional: [] };

  for (let i = 0; i < args.length; i++) {
    let arg = args[i];

    // -- signals end of options; everything after is positional
    if (arg === "--") {
      flags._positional.push(...args.slice(i + 1));
      break;
    }

    // Handle --key=value syntax
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      if (VALUE_FLAGS[key]) { flags[VALUE_FLAGS[key]] = val; continue; }
      // Boolean flags with =value (unusual but handle gracefully)
      if (key === "json") { flags.json = true; continue; }
    }

    // Handle combined short flags: -jv → -j + -v
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
      const chars = arg.slice(1);
      let allBool = true;
      for (const ch of chars) { if (!SHORT_BOOLS[ch]) { allBool = false; break; } }
      if (allBool) {
        for (const ch of chars) flags[SHORT_BOOLS[ch]] = true;
        continue;
      }
    }

    switch (arg) {
      case "--json": case "-j":
        flags.json = true; break;
      case "--no-color":
        flags.noColor = true; break;
      case "--verbose": case "-v":
        flags.verbose = true; break;
      case "--help": case "-h":
        flags.help = true; break;
      case "--version": case "-V":
        flags.version = true; break;
      case "--dry-run":
        flags.dryRun = true; break;
      case "--write":
        flags.write = true; break;
      case "--print":
        flags.print = true; break;
      case "--include-key":
        flags.includeKey = true; break;
      case "--validate":
        flags.validate = true; break;
      case "--probe":
        flags.probe = true; break;
      case "--resume":
        flags.resume = true; break;
      case "--no-browser":
        flags.noBrowser = true; break;
      case "--clear":
        flags.clear = true; break;
      case "--api-key":
        flags.apiKey = takeNext(args, i++, arg); break;
      case "--base-url":
        flags.baseUrl = takeNext(args, i++, arg); break;
      case "--timeout":
        flags.timeout = takeNext(args, i++, arg); break;
      case "--limit":
        flags.limit = takeNext(args, i++, arg); break;
      case "--discovery-id":
        flags.discoveryId = takeNext(args, i++, arg); break;
      case "--params":
        flags.params = takeNext(args, i++, arg); break;
      case "--max-size":
        flags.maxSize = takeNext(args, i++, arg); break;
      case "--codegen":
        flags.codegen = takeNext(args, i++, arg); break;
      case "--token":
        flags.token = takeNext(args, i++, arg); break;
      case "--target":
        flags.target = takeNext(args, i++, arg); break;
      case "--output":
        flags.output = takeNext(args, i++, arg); break;
      case "--query":
        flags.query = takeNext(args, i++, arg); break;
      case "--tool-id":
        flags.toolId = takeNext(args, i++, arg); break;
      case "--mode":
        flags.mode = takeNext(args, i++, arg); break;
      case "--start-date":
        flags.startDate = takeNext(args, i++, arg); break;
      case "--end-date":
        flags.endDate = takeNext(args, i++, arg); break;
      case "--bucket":
        flags.bucket = takeNext(args, i++, arg); break;
      case "--execution-id":
        flags.executionId = takeNext(args, i++, arg); break;
      case "--search-id":
        flags.searchId = takeNext(args, i++, arg); break;
      case "--event-type":
        flags.eventType = takeNext(args, i++, arg); break;
      case "--kind":
        flags.kind = takeNext(args, i++, arg); break;
      case "--success":
        flags.success = takeNext(args, i++, arg); break;
      case "--charge-outcome":
        flags.chargeOutcome = takeNext(args, i++, arg); break;
      case "--entry-type":
        flags.entryType = takeNext(args, i++, arg); break;
      case "--direction":
        flags.direction = takeNext(args, i++, arg); break;
      case "--min-credits":
        flags.minCredits = takeNext(args, i++, arg); break;
      case "--max-credits":
        flags.maxCredits = takeNext(args, i++, arg); break;
      default:
        flags._positional.push(arg);
    }
  }

  return flags;
}

function printUsage(flags = {}) {
  if (!flags.json) {
    printWelcomeBanner({ version: VERSION, noColor: flags.noColor, compact: false });
  }

  console.log(`
  ${bold("QVeris CLI")} — ${dim("discover, inspect, and call 10,000+ capabilities")}

  ${bold("Usage:")}
    qveris <command> [args] [flags]

  ${bold("Core Commands:")}
    ${cyan("init")}                         Guided first-call wizard
    ${cyan("discover")} <query>             Find capabilities by natural language
    ${cyan("inspect")}  <tool_id|index>     View tool details, parameters, and stats
    ${cyan("call")}     <tool_id|index>     Execute a capability

  ${bold("Account:")}
    ${cyan("login")}                        Authenticate with QVeris
    ${cyan("logout")}                       Remove stored API key
    ${cyan("whoami")}                       Show current auth status
    ${cyan("credits")}                      Show credit balance
    ${cyan("usage")}                        Summarize or search usage audit history
    ${cyan("ledger")}                       Summarize or search credit ledger entries

  ${bold("Configuration:")}
    ${cyan("config")}   set|get|list|reset  Manage CLI settings
    ${cyan("mcp")}      configure|validate   Generate and validate MCP client config

  ${bold("Utilities:")}
    ${cyan("interactive")}                  Launch interactive REPL mode
    ${cyan("history")}                      Show current session
    ${cyan("doctor")}                       Self-check diagnostics
    ${cyan("completions")} <shell>          Generate shell completions

  ${bold("Global Flags:")}
    --json, -j             Output raw JSON
    --api-key <key>        Override API key
    --base-url <url>       Override API base URL
    --timeout <seconds>    Request timeout
    --target <target>      MCP target: cursor | claude-desktop | claude-code | opencode | openclaw | generic
    --output <path>        MCP config output path
    --write                Write MCP config to disk
    --include-key          Include resolved API key instead of placeholder
    --probe                Start MCP server and verify visible tools during validation
    --query <query>        Init discovery query override
    --tool-id <id>         Init selected capability override
    --resume               Resume init from the last discovery session
    --mode <mode>          summary | search | export-file for usage/ledger
    --start-date <date>    Usage/ledger range start (YYYY-MM-DD)
    --end-date <date>      Usage/ledger range end (YYYY-MM-DD)
    --min-credits <n>      Usage/ledger amount lower bound
    --max-credits <n>      Usage/ledger amount upper bound
    --no-color             Disable colors
    --verbose, -v          Show request details
    --version, -V          Print version
    --help, -h             Show help

  ${bold("Environment Variables:")}
    QVERIS_API_KEY         API key
    QVERIS_REGION          Region override (global | cn)
    QVERIS_BASE_URL        Custom API base URL

  ${bold("Examples:")}
    qveris init
    qveris init --query "weather forecast API"
    qveris init --resume --params '{"city": "London"}'
    qveris discover "weather forecast API"
    qveris inspect 1
    qveris call 1 --params '{"city": "London"}'
    qveris call 1 --params @params.json --codegen curl
    qveris mcp configure --target cursor --write --include-key
    qveris mcp validate --target cursor
    qveris usage --mode search --execution-id <id>
    qveris ledger --mode search --min-credits 50 --direction consume
    qveris interactive

  ${dim("https://qveris.ai (global) / https://qveris.cn (China)")}
`);
}
