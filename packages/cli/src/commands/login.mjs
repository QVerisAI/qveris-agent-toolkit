import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { setConfigValue, deleteConfigValue, getConfigValue } from "../config/store.mjs";
import { discoverTools } from "../client/api.mjs";
import { bold, green, red, dim, cyan } from "../output/colors.mjs";

const ACCOUNT_URL = "https://qveris.ai/account?page=api-keys";

function openBrowser(url) {
  const cmds = { darwin: "open", win32: "cmd", linux: "xdg-open" };
  const cmd = cmds[platform()] || "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

/**
 * Masked input prompt using raw mode.
 * Handles Backspace, Ctrl+C, paste, and echoes * per character.
 */
function prompt(question) {
  return new Promise((resolve, reject) => {
    process.stderr.write(question);

    // Fallback for non-TTY (piped input): read without masking
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question("", (answer) => { rl.close(); resolve(answer.trim()); });
      return;
    }

    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (key) => {
      // Ctrl+C
      if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        reject(new Error("Aborted"));
        return;
      }
      // Enter
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(buf.trim());
        return;
      }
      // Backspace / Delete
      if (key === "\x7f" || key === "\b") {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stderr.write("\b \b"); // erase last *
        }
        return;
      }
      // Paste or regular character(s) — mask each char individually
      for (const ch of key) {
        if (ch.charCodeAt(0) >= 32) { // printable
          buf += ch;
          process.stderr.write("*");
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function runLogin(flags) {
  if (flags.token) {
    await validateAndSave(flags.token);
    return;
  }

  console.log(`\n  Get your API key at: ${cyan(ACCOUNT_URL)}\n`);

  if (!flags.noBrowser) {
    openBrowser(ACCOUNT_URL);
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

  await validateAndSave(key);
}

async function validateAndSave(key) {
  process.stderr.write(`  Validating key...`);

  try {
    await discoverTools({ apiKey: key, query: "test", limit: 1, timeoutMs: 10000 });
    setConfigValue("api_key", key);
    const masked = key.slice(0, 6) + "..." + key.slice(-4);
    console.error(`\r\x1b[K`);
    console.log(`  ${green("\u2713")} Authenticated as ${bold(masked)}`);
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
  const key = flags.apiKey || process.env.QVERIS_API_KEY || getConfigValue("api_key");

  if (!key) {
    console.log(`\n  Not authenticated. Run ${cyan("qveris login")} to set your API key.`);
    process.exitCode = 1;
    return;
  }

  const masked = key.slice(0, 6) + "..." + key.slice(-4);
  const source = flags.apiKey ? "flag" : process.env.QVERIS_API_KEY ? "env" : "config";

  process.stderr.write(`  Validating...`);

  try {
    await discoverTools({ apiKey: key, query: "test", limit: 1, timeoutMs: 10000 });
    process.stderr.write("\\r\\x1b[K");
    console.log(`\n  ${green("\u2713")} Authenticated`);
    console.log(`  Key:    ${bold(masked)}`);
    console.log(`  Source: ${dim(source)}`);
  } catch {
    console.error(`\r\x1b[K`);
    console.log(`\n  ${red("\u2718")} Key ${masked} is ${red("invalid")}`);
    console.log(`  Source: ${dim(source)}`);
    process.exitCode = 1;
  }
}
