import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isPlaceholderApiKey, resolveApiKey } from "../client/auth.mjs";
import { resolveBaseUrl, detectRegionFromKey } from "../config/region.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, cyan, dim, green, red, yellow } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";

const TARGETS = new Set(["cursor", "claude-desktop", "claude-code", "opencode", "openclaw", "generic"]);
const EXPECTED_TOOLS = ["discover", "inspect", "call", "usage_history", "credits_ledger"];
const API_KEY_PLACEHOLDER = "YOUR_QVERIS_API_KEY";

export async function runMcp(subcommand, args, flags) {
  switch (subcommand) {
    case "configure":
      return configure(args, flags);
    case "validate":
      return validate(args, flags);
    default:
      console.error(`  Unknown mcp subcommand: ${subcommand}`);
      console.error("  Usage: qveris mcp <configure|validate> [target]");
      process.exitCode = 2;
  }
}

function configure(args, flags) {
  const target = resolveTarget(args, flags);
  const includeKey = Boolean(flags.includeKey);
  const apiKey = includeKey ? resolveApiKey(flags.apiKey || flags.token) : API_KEY_PLACEHOLDER;
  const { baseUrl, region } = resolveBaseUrl({
    baseUrlFlag: flags.baseUrl,
    apiKey: includeKey ? apiKey : undefined,
  });
  const outputPath = flags.output || defaultConfigPath(target);
  const fragment = buildTargetFragment(target, { apiKey, baseUrl, includeKey });
  const printable = buildPrintablePayload(target, {
    fragment,
    outputPath,
    includeKey,
    baseUrl,
    region: includeKey ? region : "auto",
  });

  if (flags.write) {
    if (target === "claude-code") {
      throw new CliError("API_ERROR", "claude-code target produces shell commands; use --print and run the generated command.");
    }
    const written = writeTargetConfig(target, outputPath, fragment);
    const validation = validateConfigObject(target, written.config);
    const payload = { ...printable, wrote: true, path: written.path, validation };
    const outputPayload = redactWrittenPayload(payload);
    if (flags.json) outputJson(outputPayload);
    else printConfigureResult(outputPayload);
    return;
  }

  const validation = target === "claude-code"
    ? validateClaudeCodeCommand(fragment)
    : validateConfigObject(target, fragmentToConfig(target, fragment));
  const payload = { ...printable, wrote: false, validation };
  if (flags.json) outputJson(payload);
  else printConfigureResult(payload);
}

async function validate(args, flags) {
  const target = resolveTarget(args, flags);
  if (target === "claude-code") {
    const payload = {
      target,
      ok: true,
      checks: [
        { name: "manual_command", ok: true, message: "Claude Code uses `claude mcp add`; run `qveris mcp configure --target claude-code --print`." },
      ],
      expected_tools: EXPECTED_TOOLS,
    };
    if (flags.json) outputJson(payload);
    else printValidation(payload);
    return;
  }

  const configPath = flags.output || defaultConfigPath(target);
  const config = readJsonFile(configPath);
  const payload = { target, path: configPath, ...validateConfigObject(target, config) };
  if (flags.probe) {
    const probe = await probeVisibleTools(target, config, flags);
    payload.probe = probe;
    payload.checks = [...payload.checks, ...probe.checks];
    payload.ok = payload.ok && probe.ok;
  }
  if (flags.json) outputJson(payload);
  else printValidation(payload);
  if (!payload.ok) process.exitCode = 1;
}

function resolveTarget(args, flags) {
  const target = (flags.target || args[0] || "cursor").toLowerCase();
  if (!TARGETS.has(target)) {
    throw new CliError("API_ERROR", `Unknown MCP target "${target}". Expected one of: ${Array.from(TARGETS).join(", ")}`);
  }
  return target;
}

function buildTargetFragment(target, { apiKey, baseUrl, includeKey }) {
  const env = { QVERIS_API_KEY: apiKey };
  if (baseUrl && (includeKey || baseUrl !== "https://qveris.ai/api/v1")) env.QVERIS_BASE_URL = baseUrl;
  const stdioServer = {
    command: "npx",
    args: ["-y", "@qverisai/mcp"],
    env,
  };

  if (target === "cursor" || target === "claude-desktop") {
    return { mcpServers: { qveris: stdioServer } };
  }

  if (target === "opencode") {
    return {
      mcp: {
        qveris: {
          type: "local",
          command: ["npx", "-y", "@qverisai/mcp"],
          environment: env,
          enabled: true,
        },
      },
      tools: { "qveris*": true },
    };
  }

  if (target === "openclaw") {
    const region = includeKey ? detectRegionFromKey(apiKey) : "global";
    return {
      plugins: {
        allow: ["qveris"],
        entries: {
          qveris: {
            enabled: true,
            config: {
              apiKey,
              region,
              ...(baseUrl ? { baseUrl } : {}),
            },
          },
        },
      },
      tools: { alsoAllow: ["qveris"] },
    };
  }

  if (target === "claude-code") {
    const envArgs = buildClaudeCodeEnvArgs(env, platform());
    const windowsEnvArgs = buildClaudeCodeEnvArgs(env, "win32");
    return {
      command: `claude mcp add qveris --transport stdio --scope user ${envArgs.join(" ")} -- npx -y @qverisai/mcp`,
      windows_command: `claude mcp add qveris --transport stdio --scope user ${windowsEnvArgs.join(" ")} -- cmd /c npx -y @qverisai/mcp`,
    };
  }

  return stdioServer;
}

function buildPrintablePayload(target, { fragment, outputPath, includeKey, baseUrl, region }) {
  return {
    target,
    mode: "stdio",
    path: outputPath,
    safe_to_share: !includeKey,
    includes_real_api_key: includeKey,
    expected_tools: EXPECTED_TOOLS,
    base_url: baseUrl,
    region,
    config: fragment,
  };
}

export function writeTargetConfig(target, path, fragment) {
  const existing = existsSync(path) ? readJsonFile(path) : {};
  const merged = mergeConfig(target, existing, fragment);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  if (platform() !== "win32") chmodSync(path, 0o600);
  return { path, config: merged };
}

function mergeConfig(target, existing, fragment) {
  if (target === "generic") return fragment;
  if (target === "cursor" || target === "claude-desktop") {
    return {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        qveris: fragment.mcpServers.qveris,
      },
    };
  }
  if (target === "opencode") {
    return {
      ...existing,
      mcp: {
        ...(existing.mcp || {}),
        qveris: fragment.mcp.qveris,
      },
      tools: {
        ...(existing.tools || {}),
        ...fragment.tools,
      },
    };
  }
  if (target === "openclaw") {
    return {
      ...existing,
      plugins: {
        ...(existing.plugins || {}),
        allow: unique([...(existing.plugins?.allow || []), "qveris"]),
        entries: {
          ...(existing.plugins?.entries || {}),
          qveris: fragment.plugins.entries.qveris,
        },
      },
      tools: {
        ...(existing.tools || {}),
        alsoAllow: unique([...(existing.tools?.alsoAllow || []), "qveris"]),
      },
    };
  }
  return fragment;
}

function fragmentToConfig(target, fragment) {
  if (target === "generic" || target === "claude-code") return fragment;
  return mergeConfig(target, {}, fragment);
}

function validateConfigObject(target, config) {
  if (target === "openclaw") return validateOpenClawConfig(config);

  const checks = [];
  const server = extractServer(target, config);
  checks.push(check("config_present", Boolean(config && typeof config === "object"), "Config JSON is readable"));
  checks.push(check("qveris_entry", Boolean(server), "QVeris MCP entry exists"));
  checks.push(check("uses_qveris_mcp", serverUsesMcpPackage(server), "Config runs @qverisai/mcp"));
  checks.push(check("api_key_env", hasUsableApiKey(server, target), "QVERIS_API_KEY is configured and is not a placeholder"));

  if (target === "opencode") {
    checks.push(check("tools_enabled", config?.tools?.["qveris*"] === true, "OpenCode qveris tools are enabled"));
  }

  const ok = checks.every((item) => item.ok);
  return { ok, checks, expected_tools: EXPECTED_TOOLS };
}

function validateOpenClawConfig(config) {
  const entry = config?.plugins?.entries?.qveris;
  const checks = [
    check("config_present", Boolean(config && typeof config === "object"), "Config JSON is readable"),
    check("plugin_allowed", Array.isArray(config?.plugins?.allow) && config.plugins.allow.includes("qveris"), "OpenClaw allows the qveris plugin"),
    check("qveris_entry", Boolean(entry), "QVeris OpenClaw plugin entry exists"),
    check("plugin_enabled", entry?.enabled === true, "QVeris OpenClaw plugin is enabled"),
    check("api_key_config", hasUsableApiKey(entry, "openclaw"), "OpenClaw qveris apiKey is configured and is not a placeholder"),
    check("tools_enabled", Array.isArray(config?.tools?.alsoAllow) && config.tools.alsoAllow.includes("qveris"), "OpenClaw qveris tools are enabled"),
  ];

  return { ok: checks.every((item) => item.ok), checks, expected_tools: EXPECTED_TOOLS };
}

function validateClaudeCodeCommand(fragment) {
  const commandPresent = Boolean(fragment?.command);
  const usesPackage = Boolean(fragment?.command?.includes("@qverisai/mcp"));
  const hasUsableKey = commandHasUsableApiKey(fragment?.command);
  const checks = [
    check("command_present", commandPresent, "Claude Code command was generated"),
    check("uses_qveris_mcp", usesPackage, "Command runs @qverisai/mcp"),
    check("api_key_env", hasUsableKey, "Command includes a usable QVERIS_API_KEY value"),
  ];
  return {
    ok: checks.every((item) => item.ok),
    checks,
    expected_tools: EXPECTED_TOOLS,
  };
}

async function probeVisibleTools(target, config, flags) {
  if (target === "openclaw") {
    return {
      ok: false,
      checks: [
        check("tools_visible", false, "Live stdio probe is not available for OpenClaw plugin configs; use the OpenClaw plugin manager to confirm tool visibility."),
      ],
      tool_names: [],
    };
  }

  const server = extractServer(target, config);
  const spec = stdioSpecFromServer(target, server);
  if (!spec) {
    return {
      ok: false,
      checks: [
        check("tools_visible", false, "No stdio server command is available to probe"),
      ],
      tool_names: [],
    };
  }

  try {
    const timeoutMs = resolveProbeTimeoutMs(flags.timeout);
    const toolNames = await listMcpTools(spec, timeoutMs);
    const required = ["discover", "inspect", "call"];
    const missing = required.filter((name) => !toolNames.includes(name));
    return {
      ok: missing.length === 0,
      checks: [
        check(
          "tools_visible",
          missing.length === 0,
          missing.length === 0
            ? "Live MCP probe can see discover, inspect, and call"
            : `Live MCP probe is missing tools: ${missing.join(", ")}`
        ),
      ],
      tool_names: toolNames,
    };
  } catch (err) {
    return {
      ok: false,
      checks: [
        check("tools_visible", false, `Live MCP probe failed: ${err instanceof Error ? err.message : String(err)}`),
      ],
      tool_names: [],
    };
  }
}

function stdioSpecFromServer(target, server) {
  if (!server) return null;
  if (target === "opencode") {
    if (Array.isArray(server.command)) {
      const [command, ...args] = server.command;
      return { command, args, env: server.environment || {} };
    }
    if (typeof server.command === "string") {
      return { command: server.command, args: server.args || [], env: server.environment || {} };
    }
    return null;
  }

  if (typeof server.command === "string") {
    return { command: server.command, args: server.args || [], env: server.env || {} };
  }
  return null;
}

function listMcpTools(spec, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args || [], mcpSpawnOptions(spec.env));
    let stderr = "";
    let settled = false;
    let timer;
    let rl;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rl) rl.close();
      child.kill();
      fn(value);
    };

    timer = setTimeout(() => {
      finish(reject, new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const writeJson = (message) => {
      child.stdin.write(JSON.stringify(message) + "\n");
    };

    const handleMessage = (message) => {
      if (message.id === 1) {
        if (message.error) {
          finish(reject, new Error(message.error.message || "initialize failed"));
          return;
        }
        writeJson({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        writeJson({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (message.id === 2) {
        if (message.error) {
          finish(reject, new Error(message.error.message || "tools/list failed"));
          return;
        }
        const toolNames = Array.isArray(message.result?.tools)
          ? message.result.tools.map((tool) => tool.name).filter(Boolean)
          : [];
        finish(resolve, toolNames);
      }
    };

    rl = createInterface({ input: child.stdout, terminal: false });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        handleMessage(JSON.parse(line));
      } catch {
        finish(reject, new Error(`invalid MCP JSON response: ${line.slice(0, 120)}`));
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", (err) => finish(reject, err));

    child.on("error", (err) => finish(reject, err));
    child.on("exit", (code) => {
      if (!settled) {
        const detail = stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : "";
        finish(reject, new Error(`server exited before tools/list (code ${code})${detail}`));
      }
    });

    writeJson({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "qveris-cli", version: "mcp-validate" },
      },
    });
  });
}

export function resolveProbeTimeoutMs(timeout) {
  const seconds = Number.parseFloat(timeout ?? "15");
  const usableSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 15;
  return Math.max(1000, usableSeconds * 1000);
}

export function mcpSpawnOptions(env = {}, os = platform()) {
  return {
    env: { ...process.env, ...(env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: os === "win32",
  };
}

function extractServer(target, config) {
  if (target === "cursor" || target === "claude-desktop") return config?.mcpServers?.qveris;
  if (target === "opencode") return config?.mcp?.qveris;
  if (target === "openclaw") return config?.plugins?.entries?.qveris;
  if (target === "generic") return config;
  return null;
}

function serverUsesMcpPackage(server) {
  if (!server) return false;
  const serialized = JSON.stringify(server);
  return serialized.includes("@qverisai/mcp");
}

function hasUsableApiKey(server, target) {
  if (!server) return false;
  const value = target === "openclaw"
    ? server.config?.apiKey
    : server.env?.QVERIS_API_KEY || server.environment?.QVERIS_API_KEY;
  if (typeof value !== "string" || !value.trim()) return false;
  return !isPlaceholderApiKey(value);
}

function check(name, ok, message) {
  return { name, ok, message };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    const detail = err.code === "ENOENT" ? `File not found: ${path}` : `Invalid JSON in ${path}: ${err.message}`;
    throw new CliError("API_ERROR", detail);
  }
}

function defaultConfigPath(target) {
  const home = homedir();
  const os = platform();
  if (target === "cursor") return join(home, ".cursor", "mcp.json");
  if (target === "opencode") return join(home, ".config", "opencode", "opencode.json");
  if (target === "openclaw") return join(home, ".openclaw", "openclaw.json");
  if (target === "generic") return join(process.cwd(), "qveris-mcp.json");
  if (target === "claude-desktop") {
    if (os === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    if (os === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    return join(home, ".config", "Claude", "claude_desktop_config.json");
  }
  return "";
}

function printConfigureResult(payload) {
  console.log(`\n  ${bold("QVeris MCP configure")} ${dim(payload.target)}\n`);
  if (payload.wrote) {
    console.log(`  ${green("✓")} Wrote config: ${cyan(payload.path)}`);
  } else {
    console.log(`  ${yellow("!")} Dry run / print mode. Nothing was written.`);
    if (payload.path) console.log(`  ${dim("Default path:")} ${payload.path}`);
  }
  console.log(`  ${dim("Includes real API key:")} ${payload.includes_real_api_key ? red("yes") : green("no")}`);
  console.log(`  ${dim("Expected tools:")} ${payload.expected_tools.join(", ")}`);
  console.log("\n" + JSON.stringify(payload.config, null, 2));
  if (!payload.wrote && payload.target !== "claude-code") {
    console.log(`\n  ${dim("Write placeholder config with:")} qveris mcp configure --target ${payload.target} --write`);
    console.log(`  ${dim("Write working config with current key:")} qveris mcp configure --target ${payload.target} --write --include-key`);
  }
  if (payload.validation) printValidation(payload.validation);
}

function redactWrittenPayload(payload) {
  if (!payload.wrote || !payload.includes_real_api_key) return payload;
  return { ...payload, config: redactConfigSecrets(payload.config) };
}

function redactConfigSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => redactConfigSecrets(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    isSecretConfigKey(key) ? "********" : redactConfigSecrets(nested),
  ]));
}

function isSecretConfigKey(key) {
  return key === "QVERIS_API_KEY" || key === "apiKey";
}

function printValidation(payload) {
  console.log(`\n  ${bold("MCP validation")}${payload.target ? ` ${dim(payload.target)}` : ""}\n`);
  for (const item of payload.checks || []) {
    console.log(`  ${item.ok ? green("✓") : red("✘")} ${item.message}`);
  }
  console.log(`  ${dim("Expected canonical tools:")} ${(payload.expected_tools || EXPECTED_TOOLS).join(", ")}`);
  console.log(payload.ok ? `\n  ${green("MCP config looks valid.")}\n` : `\n  ${red("MCP config needs attention.")}\n`);
}

function buildClaudeCodeEnvArgs(env, os) {
  const envArgs = [`--env QVERIS_API_KEY=${shellQuoteForPlatform(env.QVERIS_API_KEY, os)}`];
  if (env.QVERIS_BASE_URL) {
    envArgs.push(`--env QVERIS_BASE_URL=${shellQuoteForPlatform(env.QVERIS_BASE_URL, os)}`);
  }
  return envArgs;
}

export function shellQuoteForPlatform(value, os = platform()) {
  if (os === "win32") return `"${String(value).replaceAll("\"", "\"\"")}"`;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function commandHasUsableApiKey(command) {
  const value = extractEnvAssignmentValue(command, "QVERIS_API_KEY");
  return typeof value === "string" && value.trim() !== "" && !isPlaceholderApiKey(value);
}

export function extractEnvAssignmentValue(command, name) {
  if (typeof command !== "string") return null;
  const marker = `${name}=`;
  let start = command.indexOf(marker);
  while (start !== -1 && start > 0 && !/\s/.test(command[start - 1])) {
    start = command.indexOf(marker, start + marker.length);
  }
  if (start === -1) return null;
  const valueStart = start + marker.length;
  return readShellToken(command, valueStart);
}

function readShellToken(command, start) {
  let value = "";
  let quote = null;
  for (let i = start; i < command.length; i++) {
    const char = command[i];
    if (!quote && /\s/.test(char)) break;

    if (quote === "'") {
      if (char === "'") quote = null;
      else value += char;
      continue;
    }

    if (quote === "\"") {
      if (char === "\"") {
        if (command[i + 1] === "\"") {
          value += "\"";
          i += 1;
        } else {
          quote = null;
        }
      } else if (char === "\\" && i + 1 < command.length) {
        value += command[i + 1];
        i += 1;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") quote = char;
    else if (char === "\\" && i + 1 < command.length) {
      value += command[i + 1];
      i += 1;
    } else {
      value += char;
    }
  }
  return value;
}

function unique(values) {
  return Array.from(new Set(values));
}
