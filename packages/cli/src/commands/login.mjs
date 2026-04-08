import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "../config/resolve.mjs";
import { setConfigValue, deleteConfigValue } from "../config/store.mjs";
import { discoverTools } from "../client/api.mjs";
import { VERSION } from "../config/defaults.mjs";
import { resolveBaseUrl, getSiteUrl } from "../config/region.mjs";
import { bold, green, red, dim, cyan } from "../output/colors.mjs";
import { printLoginBanner } from "../output/banner.mjs";

function openBrowser(url) {
  const cmds = { darwin: "open", win32: "cmd", linux: "xdg-open" };
  const cmd = cmds[platform()] || "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

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
      rl.question("", (answer) => { rl.close(); pResolve(answer.trim()); });
      return;
    }

    let buf = "";

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      try { process.stdin.setRawMode(false); } catch { /* already restored */ }
      process.stdin.pause();
    };

    // Safety net: restore terminal if process exits unexpectedly
    const onExit = () => { try { process.stdin.setRawMode(false); } catch {} };
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

/**
 * Prompt user to select region interactively.
 * Skipped if region is already determined via --base-url, QVERIS_REGION, or QVERIS_BASE_URL.
 */
function promptRegion() {
  return new Promise((pResolve, pReject) => {
    console.log(`  ${bold("Select your region / 选择站点区域:")}\n`);
    console.log(`    ${cyan("1)")} Global  — qveris.ai  (International users)`);
    console.log(`    ${cyan("2)")} China   — qveris.cn  (中国大陆用户)\n`);

    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question("  Enter 1 or 2: ", (answer) => { rl.close(); pResolve(answer.trim()); });
      return;
    }

    process.stderr.write("  Enter 1 or 2: ");

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
    };
    const onExit = () => { try { process.stdin.setRawMode(false); } catch {} };
    process.once("exit", onExit);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (chunk) => {
      const ch = chunk[0];
      if (ch === "\x03") { cleanup(); process.removeListener("exit", onExit); process.stderr.write("\n"); pReject(new Error("Aborted")); return; }
      if (ch === "1" || ch === "2") {
        cleanup();
        process.removeListener("exit", onExit);
        process.stderr.write(`${ch}\n`);
        pResolve(ch);
      }
      // Ignore other keys
    };
    process.stdin.on("data", onData);
  });
}

export async function runLogin(flags) {
  if (flags.token) {
    await validateAndSave(flags.token, flags.baseUrl);
    return;
  }

  if (!flags.json) {
    printLoginBanner({ version: VERSION, noColor: flags.noColor });
  }

  // Determine region: if already set via flag/env, use that; otherwise ask the user.
  const { region: presetRegion, baseUrl: presetBaseUrl, source: regionSource } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  let region;
  let baseUrl = presetBaseUrl;
  if (regionSource !== "default") {
    // Region explicitly configured — use it directly
    region = presetRegion;
  } else {
    // No explicit region — let user choose interactively
    let choice;
    try {
      choice = await promptRegion();
    } catch {
      return; // Ctrl+C
    }
    region = choice === "2" ? "cn" : "global";
  }

  const accountUrl = `${getSiteUrl(region, baseUrl)}/account?page=api-keys`;
  console.log(`\n  Get your API key at: ${cyan(accountUrl)}\n`);

  if (!flags.noBrowser) {
    openBrowser(accountUrl);
  }

  let key;
  try {
    key = await prompt("  Paste your API key: ");
  } catch {
    // Ctrl+C during prompt
    return;
  }
  if (!key) {
    console.error(`  ${red("\u2718")} No key provided.`);
    process.exitCode = 1;
    return;
  }

  await validateAndSave(key, flags.baseUrl);
}

async function validateAndSave(key, baseUrlFlag) {
  process.stderr.write(`  Validating key...`);

  const { baseUrl, region, source } = resolveBaseUrl({ baseUrlFlag, apiKey: key });

  try {
    await discoverTools({ apiKey: key, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
    setConfigValue("api_key", key);
    const masked = key.slice(0, 6) + "..." + key.slice(-4);
    console.error(`\r\x1b[K`);
    console.log(`  ${green("\u2713")} Authenticated as ${bold(masked)}`);
    console.log(`  ${dim("Region:")} ${region} ${dim(`(${source})`)}`);
    console.log(`  ${dim("Key saved to config.")}`);
  } catch {
    console.error(`\r\x1b[K`);
    console.error(`  ${red("\u2718")} Invalid API key. Please check and try again.`);
    process.exitCode = 1;
  }
}

export async function runLogout() {
  deleteConfigValue("api_key");
  console.log(`  ${green("\u2713")} API key removed from config.`);
}

export async function runWhoami(flags) {
  const { value: key, source } = resolve("api_key", flags.apiKey);

  if (!key) {
    console.log(`\n  Not authenticated. Run ${cyan("qveris login")} to set your API key.`);
    process.exitCode = 1;
    return;
  }

  const masked = key.slice(0, 6) + "..." + key.slice(-4);
  const { baseUrl, region, source: regionSource } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey: key });

  process.stderr.write(`  Validating...`);

  try {
    await discoverTools({ apiKey: key, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
    process.stderr.write("\r\x1b[K");
    console.log(`\n  ${green("\u2713")} Authenticated`);
    console.log(`  Key:    ${bold(masked)}`);
    console.log(`  Source: ${dim(source)}`);
    console.log(`  Region: ${region} ${dim(`(${regionSource})`)}`);
  } catch {
    console.error(`\r\x1b[K`);
    console.log(`\n  ${red("\u2718")} Key ${masked} is ${red("invalid")}`);
    console.log(`  Source: ${dim(source)}`);
    process.exitCode = 1;
  }
}
