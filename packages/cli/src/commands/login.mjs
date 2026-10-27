import { createInterface } from "node:readline";
import { resolve } from "../config/resolve.mjs";
import { setConfigValue, deleteConfigValue } from "../config/store.mjs";
import { discoverTools, resolveApiBaseUrl } from "../client/api.mjs";
import { resolveApiKey } from "../client/auth.mjs";
import { CliError, handleError } from "../errors/handler.mjs";
import { validationError } from "../client/validation-error.mjs";
import { outputJson } from "../output/json.mjs";
import { VERSION } from "../config/defaults.mjs";
import { resolveBaseUrl, getSiteUrl } from "../config/endpoint.mjs";
import { bold, green, dim, cyan } from "../output/colors.mjs";
import { printLoginBanner } from "../output/banner.mjs";
import { openUrl } from "../utils/open-url.mjs";
import { withOAuthRefreshLock } from "../auth/storage.mjs";

/**
 * Masked input prompt using raw mode.
 * Handles Backspace, Ctrl+C, paste (multi-char chunks), and echoes * per character.
 */
function prompt(question) {
  return new Promise((pResolve, pReject) => {
    process.stderr.write(question);

    // Fallback for non-TTY (piped input): read without masking
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question("", (answer) => {
        rl.close();
        pResolve(answer.trim());
      });
      return;
    }

    let buf = "";

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* already restored */
      }
      process.stdin.pause();
    };

    // Safety net: restore terminal if process exits unexpectedly
    const onExit = () => {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* not a TTY */
      }
    };
    process.once("exit", onExit);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    // Process each character in the chunk individually to handle paste correctly
    const onData = (chunk) => {
      for (const char of chunk) {
        // Ctrl+C
        if (char === "\x03") {
          cleanup();
          process.removeListener("exit", onExit);
          process.stderr.write("\n");
          pReject(new Error("Aborted"));
          return;
        }
        // Enter
        if (char === "\r" || char === "\n") {
          cleanup();
          process.removeListener("exit", onExit);
          process.stderr.write("\n");
          pResolve(buf.trim());
          return;
        }
        // Backspace / Delete
        if (char === "\x7f" || char === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stderr.write("\b \b");
          }
          continue;
        }
        // Printable character
        if (char.charCodeAt(0) >= 32) {
          buf += char;
          process.stderr.write("*");
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function runLogin(flags) {
  if (flags.token) {
    await validateAndSave(flags.token, flags);
    return;
  }

  if (!flags.json) {
    printLoginBanner({ version: VERSION, noColor: flags.noColor });
  }

  const { baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  const accountUrl = `${getSiteUrl(baseUrl)}/account?page=api-keys`;
  if (!flags.json)
    console.error(
      `\n  API key login: paste and validate an existing key. For OAuth Device Flow, run qveris auth login.\n  Get your API key at: ${cyan(accountUrl)}\n`,
    );

  if (!flags.noBrowser) {
    openUrl(accountUrl);
  }

  let key;
  try {
    key = await prompt(flags.json ? "" : "  Paste your API key: ");
  } catch {
    // Ctrl+C during prompt
    return;
  }
  if (!key) {
    handleError(new CliError("AUTH_MISSING_KEY"), flags.json);
    return;
  }

  await validateAndSave(key, flags);
}

async function validateAndSave(key, flags) {
  const { baseUrl, source } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  const credentialSource = flags.token ? "flag (--token)" : "prompt";
  const context = { type: "api_key", source: credentialSource, endpoint: baseUrl, endpoint_source: source };
  if (!flags.json) process.stderr.write(`  Validating API key...`);
  try {
    await discoverTools({ apiKey: key, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
  } catch (error) {
    if (!flags.json) process.stderr.write("\r\x1b[K");
    handleError(validationError(error, context), flags.json);
    return;
  }
  if (!flags.json) process.stderr.write("\r\x1b[K");
  await withOAuthRefreshLock(async () => setConfigValue("api_key", key));
  if (flags.json) {
    outputJson({ authenticated: true, ...context, saved_to: "config" });
    return;
  }
  console.log(`  ${green("✓")} Authenticated as ${bold(maskKey(key))} (API key)`);
  console.log(`  ${dim("Endpoint:")} ${baseUrl} ${dim(`(${source})`)}`);
  console.log(`  ${dim("Key saved to config. Explicit --api-key and QVERIS_API_KEY take precedence.")}`);
}

function maskKey(key) {
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : "***";
}

export async function runLogout() {
  await withOAuthRefreshLock(async () => deleteConfigValue("api_key"));
  console.log(`  ${green("\u2713")} API key removed from config.`);
}

export async function runWhoami(flags) {
  const { source } = resolve("api_key", flags.apiKey);
  const key = resolveApiKey(flags.apiKey);
  const type = key === undefined ? "oauth" : "api_key";
  const { baseUrl, source: endpointSource } = resolveApiBaseUrl({
    baseUrlFlag: flags.baseUrl,
    preferOAuth: type === "oauth",
  });
  const context = {
    type,
    source: type === "oauth" ? "oauth session" : source,
    endpoint: baseUrl,
    endpoint_source: endpointSource,
  };
  if (!flags.json) process.stderr.write("  Validating...");
  try {
    await discoverTools({ apiKey: key, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
  } catch (error) {
    if (!flags.json) process.stderr.write("\r\x1b[K");
    handleError(validationError(error, context), flags.json);
    return;
  }
  if (flags.json) return outputJson({ authenticated: true, ...context });
  process.stderr.write("\r\x1b[K");
  console.log(`\n  ${green("✓")} Authenticated (${type === "oauth" ? "OAuth Device Flow" : "API key"})`);
  if (key !== undefined) console.log(`  Key:    ${bold(maskKey(key))}`);
  console.log(`  Source: ${dim(context.source)}`);
  console.log(`  Endpoint: ${baseUrl} ${dim(`(${endpointSource})`)}`);
}
