import { normalizeLegacyArgs } from "./compat/aliases.mjs";
import { handleError } from "./errors/handler.mjs";
import { VERSION } from "./config/defaults.mjs";
import { bold, dim, cyan } from "./output/colors.mjs";

export async function main(argv) {
  const rawArgs = argv.slice(2);
  const { args, warnings } = normalizeLegacyArgs(rawArgs);

  for (const w of warnings) {
    console.error(`  ${dim("Deprecated:")} ${w}`);
  }

  const flags = extractGlobalFlags(args);
  const positional = flags._positional;
  const command = positional[0];
  const rest = positional.slice(1);

  if (flags.version) {
    console.log(`qveris/${VERSION}`);
    return;
  }

  if (!command || flags.help) {
    printUsage();
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
      case "config": {
        const subcommand = rest[0];
        const subArgs = rest.slice(1);
        if (!subcommand) { console.error("  Usage: qveris config <set|get|list|reset|path>"); process.exitCode = 2; return; }
        const { runConfig } = await import("./commands/config.mjs");
        await runConfig(subcommand, subArgs, flags);
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

function extractGlobalFlags(args) {
  const flags = { _positional: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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
      case "--no-browser":
        flags.noBrowser = true; break;
      case "--clear":
        flags.clear = true; break;
      case "--api-key":
        flags.apiKey = args[++i]; break;
      case "--base-url":
        flags.baseUrl = args[++i]; break;
      case "--timeout":
        flags.timeout = args[++i]; break;
      case "--limit":
        flags.limit = args[++i]; break;
      case "--discovery-id":
        flags.discoveryId = args[++i]; break;
      case "--params":
        flags.params = args[++i]; break;
      case "--max-size":
        flags.maxSize = args[++i]; break;
      case "--codegen":
        flags.codegen = args[++i]; break;
      case "--token":
        flags.token = args[++i]; break;
      default:
        flags._positional.push(arg);
    }
  }

  return flags;
}

function printUsage() {
  console.log(`
  ${bold("QVeris CLI")} ${dim(`v${VERSION}`)} -- discover, inspect, and call 10,000+ capabilities

  ${bold("Usage:")}
    qveris <command> [args] [flags]

  ${bold("Core Commands:")}
    ${cyan("discover")} <query>             Find capabilities by natural language
    ${cyan("inspect")}  <tool_id|index>     View tool details, parameters, and stats
    ${cyan("call")}     <tool_id|index>     Execute a capability

  ${bold("Account:")}
    ${cyan("login")}                        Authenticate with QVeris
    ${cyan("logout")}                       Remove stored API key
    ${cyan("whoami")}                       Show current auth status
    ${cyan("credits")}                      Show credit balance

  ${bold("Configuration:")}
    ${cyan("config")}   set|get|list|reset  Manage CLI settings

  ${bold("Utilities:")}
    ${cyan("interactive")}                  Launch interactive REPL mode
    ${cyan("history")}                      Show current session
    ${cyan("doctor")}                       Self-check diagnostics
    ${cyan("completions")} <shell>          Generate shell completions

  ${bold("Global Flags:")}
    --json, -j             Output raw JSON
    --api-key <key>        Override API key
    --timeout <seconds>    Request timeout
    --no-color             Disable colors
    --verbose, -v          Show request details
    --version, -V          Print version
    --help, -h             Show help

  ${bold("Examples:")}
    qveris discover "weather forecast API"
    qveris inspect 1
    qveris call 1 --params '{"city": "London"}'
    qveris call 1 --params @params.json --codegen curl
    qveris interactive

  ${dim("https://qveris.ai")}
`);
}
