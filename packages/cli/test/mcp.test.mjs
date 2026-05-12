import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractEnvAssignmentValue,
  mcpSpawnOptions,
  resolveProbeTimeoutMs,
  shellQuoteForPlatform,
  writeTargetConfig,
} from "../src/commands/mcp.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/qveris.mjs", import.meta.url));

function runCli(args) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.QVERIS_API_KEY;
  delete env.QVERIS_BASE_URL;
  delete env.QVERIS_REGION;
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    env,
  });
}

function parseCliJson(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("mcp configure enforces owner-only permissions on existing config files", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const path = join(dir, "mcp.json");
    const fragment = {
      command: "npx",
      args: ["-y", "@qverisai/mcp"],
      env: { QVERIS_API_KEY: "sk-test" },
    };

    writeFileSync(path, "{}\n", { mode: 0o644 });
    if (platform() !== "win32") chmodSync(path, 0o644);

    const written = writeTargetConfig("generic", path, fragment);

    assert.equal(written.path, path);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), fragment);
    if (platform() !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp live probe enables shell execution on Windows only", () => {
  const windowsOptions = mcpSpawnOptions({ QVERIS_API_KEY: "sk-test" }, "win32");
  assert.equal(windowsOptions.shell, true);
  assert.equal(windowsOptions.env.QVERIS_API_KEY, "sk-test");
  assert.deepEqual(windowsOptions.stdio, ["pipe", "pipe", "pipe"]);

  const posixOptions = mcpSpawnOptions({}, "darwin");
  assert.equal(posixOptions.shell, false);
});

test("mcp command quoting follows the target shell platform", () => {
  assert.equal(shellQuoteForPlatform("L'Ondon", "darwin"), `'L'\\''Ondon'`);
  assert.equal(shellQuoteForPlatform('say "hi"', "win32"), `"say ""hi"""`);
});

test("mcp probe timeout parsing always returns a valid duration", () => {
  assert.equal(resolveProbeTimeoutMs("2.5"), 2500);
  assert.equal(resolveProbeTimeoutMs("0.25"), 1000);
  assert.equal(resolveProbeTimeoutMs("not-a-number"), 15000);
  assert.equal(resolveProbeTimeoutMs("-2"), 15000);
  assert.equal(resolveProbeTimeoutMs(undefined), 15000);
});

test("mcp command env extraction handles shell quoted values", () => {
  assert.equal(
    extractEnvAssignmentValue("claude mcp add --env QVERIS_API_KEY='sk-test' -- npx", "QVERIS_API_KEY"),
    "sk-test"
  );
  assert.equal(
    extractEnvAssignmentValue("claude mcp add --env QVERIS_API_KEY='sk'\\''quoted' -- npx", "QVERIS_API_KEY"),
    "sk'quoted"
  );
  assert.equal(
    extractEnvAssignmentValue('claude mcp add --env QVERIS_API_KEY="sk ""quoted""" -- cmd /c npx', "QVERIS_API_KEY"),
    'sk "quoted"'
  );
  assert.equal(
    extractEnvAssignmentValue("NOT_QVERIS_API_KEY=bad QVERIS_API_KEY=sk-real", "QVERIS_API_KEY"),
    "sk-real"
  );
});

test("mcp configure emits valid JSON fragments for each supported target", () => {
  const targets = ["cursor", "claude-desktop", "opencode", "openclaw", "generic", "claude-code"];
  for (const target of targets) {
    const result = runCli([
      "mcp",
      "configure",
      target,
      "--api-key",
      "sk-test",
      "--base-url",
      "https://unit.test/api/v1/",
      "--include-key",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseCliJson(result);

    assert.equal(payload.target, target);
    assert.equal(payload.wrote, false);
    assert.equal(payload.includes_real_api_key, true);
    assert.equal(payload.base_url, "https://unit.test/api/v1");
    assert.deepEqual(payload.expected_tools, ["discover", "inspect", "call", "usage_history", "credits_ledger"]);
    assert.equal(payload.validation.ok, true);

    if (target === "cursor" || target === "claude-desktop") {
      assert.equal(payload.config.mcpServers.qveris.command, "npx");
      assert.deepEqual(payload.config.mcpServers.qveris.args, ["-y", "@qverisai/mcp"]);
      assert.equal(payload.config.mcpServers.qveris.env.QVERIS_API_KEY, "sk-test");
    } else if (target === "opencode") {
      assert.deepEqual(payload.config.mcp.qveris.command, ["npx", "-y", "@qverisai/mcp"]);
      assert.equal(payload.config.mcp.qveris.environment.QVERIS_API_KEY, "sk-test");
      assert.equal(payload.config.tools["qveris*"], true);
    } else if (target === "openclaw") {
      assert.deepEqual(payload.config.plugins.allow, ["qveris"]);
      assert.equal(payload.config.plugins.entries.qveris.config.apiKey, "sk-test");
      assert.deepEqual(payload.config.tools.alsoAllow, ["qveris"]);
    } else if (target === "generic") {
      assert.equal(payload.config.command, "npx");
      assert.equal(payload.config.env.QVERIS_API_KEY, "sk-test");
    } else if (target === "claude-code") {
      assert.match(payload.config.command, /claude mcp add qveris/);
      assert.match(payload.config.command, /@qverisai\/mcp/);
      assert.match(payload.config.windows_command, /cmd \/c npx -y @qverisai\/mcp/);
      assert.match(payload.config.windows_command, /QVERIS_BASE_URL="https:\/\/unit\.test\/api\/v1"/);
    }
  }
});

test("mcp command is reachable through the CLI and parses target flags", () => {
  const result = runCli(["mcp", "configure", "--target", "generic", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseCliJson(result);

  assert.equal(payload.target, "generic");
  assert.equal(payload.safe_to_share, true);
  assert.equal(payload.config.env.QVERIS_API_KEY, "YOUR_QVERIS_API_KEY");
});

test("mcp command parses MCP value flags with equals syntax", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const path = join(dir, "generic-mcp.json");
    const result = runCli(["mcp", "configure", "--target=generic", `--output=${path}`, "--write", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseCliJson(result);

    assert.equal(payload.target, "generic");
    assert.equal(payload.path, path);
    assert.equal(existsSync(path), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp configure write merges cursor config and validate reads it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const path = join(dir, "cursor-mcp.json");
    writeFileSync(path, JSON.stringify({
      mcpServers: {
        existing: { command: "node", args: ["server.js"], env: { TOKEN: "keep" } },
      },
    }, null, 2) + "\n");

    const configureResult = runCli([
      "mcp",
      "configure",
      "--target",
      "cursor",
      "--output",
      path,
      "--write",
      "--include-key",
      "--api-key",
      "sk-test",
      "--json",
    ]);
    assert.equal(configureResult.status, 0, configureResult.stderr);
    const configured = parseCliJson(configureResult);
    const fileConfig = JSON.parse(readFileSync(path, "utf8"));

    assert.equal(configured.wrote, true);
    assert.equal(configured.validation.ok, true);
    assert.equal(fileConfig.mcpServers.existing.env.TOKEN, "keep");
    assert.equal(fileConfig.mcpServers.qveris.env.QVERIS_API_KEY, "sk-test");

    const validateResult = runCli(["mcp", "validate", "--target", "cursor", "--output", path, "--json"]);
    assert.equal(validateResult.status, 0, validateResult.stderr);
    const validated = parseCliJson(validateResult);

    assert.equal(validated.ok, true);
    assert.deepEqual(
      validated.checks.map((item) => [item.name, item.ok]),
      [
        ["config_present", true],
        ["qveris_entry", true],
        ["uses_qveris_mcp", true],
        ["api_key_env", true],
      ]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp configure write redacts real api keys from command output", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const jsonPath = join(dir, "generic-json.json");
    const jsonResult = runCli([
      "mcp",
      "configure",
      "--target",
      "generic",
      "--output",
      jsonPath,
      "--write",
      "--include-key",
      "--api-key",
      "sk-secret-123",
      "--json",
    ]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    assert.equal(jsonResult.stdout.includes("sk-secret-123"), false);
    const jsonPayload = parseCliJson(jsonResult);

    assert.equal(jsonPayload.config.env.QVERIS_API_KEY, "********");
    assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).env.QVERIS_API_KEY, "sk-secret-123");

    const humanPath = join(dir, "generic-human.json");
    const humanResult = runCli([
      "mcp",
      "configure",
      "--target",
      "generic",
      "--output",
      humanPath,
      "--write",
      "--include-key",
      "--api-key",
      "sk-secret-456",
    ]);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.equal(humanResult.stdout.includes("sk-secret-456"), false);
    assert.equal(humanResult.stdout.includes("********"), true);
    assert.equal(JSON.parse(readFileSync(humanPath, "utf8")).env.QVERIS_API_KEY, "sk-secret-456");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp validate reports generated placeholder keys as invalid configs", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const path = join(dir, "generic-mcp.json");
    const configureResult = runCli(["mcp", "configure", "--target", "generic", "--output", path, "--write", "--json"]);
    assert.equal(configureResult.status, 0, configureResult.stderr);

    const validateResult = runCli(["mcp", "validate", "--target", "generic", "--output", path, "--json"]);
    assert.equal(validateResult.status, 1, validateResult.stderr);
    const payload = parseCliJson(validateResult);

    assert.equal(payload.ok, false);
    assert.equal(payload.checks.find((item) => item.name === "api_key_env").ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp validate rejects common manual placeholder keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const cases = [
      {
        target: "generic",
        check: "api_key_env",
        key: "your-api-key",
        config: {
          command: "npx",
          args: ["-y", "@qverisai/mcp"],
          env: { QVERIS_API_KEY: "your-api-key" },
        },
      },
      {
        target: "generic",
        check: "api_key_env",
        key: "YOUR_API_KEY",
        config: {
          command: "npx",
          args: ["-y", "@qverisai/mcp"],
          env: { QVERIS_API_KEY: "YOUR_API_KEY" },
        },
      },
      {
        target: "openclaw",
        check: "api_key_config",
        key: "your-api-key",
        config: {
          plugins: {
            allow: ["qveris"],
            entries: {
              qveris: {
                enabled: true,
                config: { apiKey: "your-api-key", region: "global" },
              },
            },
          },
          tools: { alsoAllow: ["qveris"] },
        },
      },
    ];

    for (const item of cases) {
      const path = join(dir, `${item.target}-${item.key}.json`);
      writeFileSync(path, JSON.stringify(item.config, null, 2) + "\n");

      const result = runCli(["mcp", "validate", "--target", item.target, "--output", path, "--json"]);
      assert.equal(result.status, 1, result.stderr);
      const payload = parseCliJson(result);

      assert.equal(payload.ok, false);
      assert.equal(payload.checks.find((check) => check.name === item.check).ok, false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mcp configure claude-code marks placeholder commands invalid", () => {
  const result = runCli(["mcp", "configure", "--target", "claude-code", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseCliJson(result);

  assert.equal(payload.config.command.includes("YOUR_QVERIS_API_KEY"), true);
  assert.equal(payload.validation.ok, false);
  assert.equal(payload.validation.checks.find((item) => item.name === "api_key_env").ok, false);
});

test("mcp validate probe verifies visible stdio tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-mcp-"));
  try {
    const serverPath = join(dir, "fake-mcp-server.mjs");
    const configPath = join(dir, "generic-mcp.json");
    writeFileSync(serverPath, `
import readline from "node:readline";

function writeChunked(message) {
  const line = JSON.stringify(message);
  const midpoint = Math.floor(line.length / 2);
  process.stdout.write(line.slice(0, midpoint));
  setTimeout(() => process.stdout.write(line.slice(midpoint) + "\\n"), 5);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1) {
    writeChunked({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "fake-qveris-mcp-探测", version: "1.0.0" }
      }
    });
  }
  if (message.id === 2) {
    writeChunked({
      jsonrpc: "2.0",
      id: 2,
      result: { tools: [{ name: "discover" }, { name: "inspect" }, { name: "call" }] }
    });
  }
});
`);
    writeFileSync(configPath, JSON.stringify({
      command: process.execPath,
      args: [serverPath, "--package=@qverisai/mcp"],
      env: { QVERIS_API_KEY: "sk-test" },
    }, null, 2) + "\n");

    const result = runCli([
      "mcp",
      "validate",
      "--target",
      "generic",
      "--output",
      configPath,
      "--probe",
      "--timeout",
      "not-a-number",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseCliJson(result);

    assert.equal(payload.ok, true);
    assert.equal(payload.probe.ok, true);
    assert.deepEqual(payload.probe.tool_names, ["discover", "inspect", "call"]);
    assert.equal(payload.checks.find((item) => item.name === "tools_visible").ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
