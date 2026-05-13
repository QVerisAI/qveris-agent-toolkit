import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCall } from "../src/commands/call.mjs";
import { runCompletions } from "../src/commands/completions.mjs";
import { runConfig } from "../src/commands/config.mjs";
import { runCredits } from "../src/commands/credits.mjs";
import { runDiscover } from "../src/commands/discover.mjs";
import { runDoctor } from "../src/commands/doctor.mjs";
import { runHistory } from "../src/commands/history.mjs";
import { runInspect } from "../src/commands/inspect.mjs";
import { runLedger } from "../src/commands/ledger.mjs";
import { runLogin, runLogout, runWhoami } from "../src/commands/login.mjs";
import { runUsage } from "../src/commands/usage.mjs";
import { getConfigPath } from "../src/config/store.mjs";
import { main } from "../src/main.mjs";

function withTempConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-commands-"));
  const previous = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    QVERIS_API_KEY: process.env.QVERIS_API_KEY,
    QVERIS_BASE_URL: process.env.QVERIS_BASE_URL,
    QVERIS_REGION: process.env.QVERIS_REGION,
    NO_COLOR: process.env.NO_COLOR,
  };
  process.env.XDG_CONFIG_HOME = dir;
  process.env.NO_COLOR = "1";
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  delete process.env.QVERIS_REGION;

  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    });
}

async function captureOutput(fn) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  process.stdout.write = function write(chunk, ...args) {
    stdoutChunks.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  process.stderr.write = function write(chunk, ...args) {
    stderrChunks.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}

function jsonFromStdout(stdout) {
  return JSON.parse(stdout);
}

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = {
      url: new URL(url),
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return Promise.resolve()
    .then(() => fn(requests))
    .finally(() => {
      globalThis.fetch = original;
    });
}

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("discover, inspect, call, and history commands cover session-based workflow", async () => {
  await withTempConfig(async (configDir) => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        assert.deepEqual(request.body, { query: "weather forecast", limit: 2 });
        return response({
          search_id: "search-1",
          total: 1,
          results: [{ tool_id: "weather.tool.v1", name: "Weather", description: "Forecast" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        assert.deepEqual(request.body, { tool_ids: ["weather.tool.v1"], search_id: "search-1" });
        return response({
          search_id: "search-1",
          results: [{ tool_id: "weather.tool.v1", name: "Weather", description: "Forecast", params: [] }],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        assert.equal(request.url.searchParams.get("tool_id"), "weather.tool.v1");
        assert.deepEqual(request.body, {
          search_id: "search-1",
          parameters: { city: "London" },
          max_response_size: 123,
        });
        return response({
          execution_id: "exec-1",
          success: true,
          result: { data: { temperature: 18 } },
          billing: { summary: "3 credits" },
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      const flags = {
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        json: true,
        timeout: "1",
      };

      const discover = await captureOutput(() => runDiscover("weather forecast", { ...flags, limit: "2" }));
      assert.equal(jsonFromStdout(discover.stdout).search_id, "search-1");
      const session = JSON.parse(readFileSync(join(configDir, "qveris", ".session.json"), "utf-8"));
      assert.equal(session.results[0].tool_id, "weather.tool.v1");

      const inspect = await captureOutput(() => runInspect(["1"], flags));
      assert.equal(jsonFromStdout(inspect.stdout).results[0].tool_id, "weather.tool.v1");

      const call = await captureOutput(() => runCall("1", {
        ...flags,
        params: '{"city":"London"}',
        maxSize: "123",
      }));
      assert.equal(jsonFromStdout(call.stdout).execution_id, "exec-1");

      const history = await captureOutput(() => runHistory({ json: true }));
      assert.equal(jsonFromStdout(history.stdout).discoveryId, "search-1");
    });
  });
});

test("call dry-run validates resolved tool, params, and max size without network", async () => {
  await withTempConfig(async () => {
    let called = false;
    await withMockFetch(() => {
      called = true;
      return response({});
    }, async () => {
      const output = await captureOutput(() => runCall("tool.direct.v1", {
        apiKey: "sk-test",
        json: true,
        dryRun: true,
        params: '{"symbol":"AAPL"}',
        maxSize: "2048",
      }));
      assert.equal(called, false);
      assert.deepEqual(jsonFromStdout(output.stdout), {
        dry_run: true,
        tool_id: "tool.direct.v1",
        discovery_id: null,
        parameters: { symbol: "AAPL" },
        max_response_size: 2048,
      });
    });
  });
});

test("credits, usage, and ledger commands cover account audit interfaces", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/auth/credits")) {
        return response({ status: "success", data: { remaining_credits: 997 } });
      }
      if (request.url.pathname.endsWith("/auth/usage/history/v2")) {
        assert.equal(request.url.searchParams.get("summary"), "true");
        assert.equal(request.url.searchParams.get("execution_id"), "exec-1");
        return response({
          status: "success",
          data: {
            items: [],
            total: 0,
            page: 1,
            page_size: 10,
            summary: {
              start_date: "2026-05-01",
              end_date: "2026-05-02",
              bucket: "day",
              total_count: 1,
              success_count: 1,
              failure_count: 0,
              charge_outcome_counts: { charged: 1 },
              pre_settlement_credits: 3,
              settled_credits: 3,
              buckets: [],
              max_charge_items: [],
            },
          },
        });
      }
      if (request.url.pathname.endsWith("/auth/credits/ledger")) {
        assert.equal(request.url.searchParams.get("summary"), "true");
        assert.equal(request.url.searchParams.get("direction"), "consume");
        return response({
          status: "success",
          data: {
            items: [],
            total: 0,
            page: 1,
            page_size: 10,
            summary: {
              start_date: "2026-05-01",
              end_date: "2026-05-02",
              bucket: "day",
              total_entries: 1,
              consumed_credits: 3,
              granted_credits: 0,
              net_amount_credits: -3,
              buckets: [],
              max_amount_items: [],
            },
          },
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      const flags = {
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        json: true,
        timeout: "1",
        startDate: "2026-05-01",
        endDate: "2026-05-02",
        bucket: "day",
        limit: "10",
      };

      const credits = await captureOutput(() => runCredits(flags));
      assert.equal(jsonFromStdout(credits.stdout).remaining_credits, 997);

      const usage = await captureOutput(() => runUsage({ ...flags, executionId: "exec-1" }));
      assert.equal(jsonFromStdout(usage.stdout).summary.total_events, 1);

      const ledger = await captureOutput(() => runLedger({ ...flags, direction: "consume" }));
      assert.equal(jsonFromStdout(ledger.stdout).summary.consumed_credits, 3);
    });
  });
});

test("config command covers set, get, list, path, and reset", async () => {
  await withTempConfig(async () => {
    const set = await captureOutput(() => runConfig("set", ["api_key", "sk-config"], { json: true }));
    assert.deepEqual(jsonFromStdout(set.stdout), { key: "api_key", value: "sk-config" });

    const get = await captureOutput(() => runConfig("get", ["api_key"], { json: true }));
    assert.deepEqual(jsonFromStdout(get.stdout), { key: "api_key", value: "sk-config" });

    const list = await captureOutput(() => runConfig("list", [], { json: true }));
    assert.equal(jsonFromStdout(list.stdout).api_key.value, "***");

    const path = await captureOutput(() => runConfig("path", [], {}));
    assert.equal(path.stdout.trim(), getConfigPath());

    await captureOutput(() => runConfig("reset", [], {}));
    const afterReset = await captureOutput(() => runConfig("get", ["api_key"], { json: true }));
    assert.deepEqual(jsonFromStdout(afterReset.stdout), { key: "api_key", value: null });
  });
});

test("login, whoami, logout, and doctor cover auth diagnostics workflow", async () => {
  await withTempConfig(async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withMockFetch((request) => {
        assert.equal(request.url.pathname, "/api/v1/search");
        assert.deepEqual(request.body, { query: "test", limit: 1 });
        return response({ search_id: "search-ok", results: [] });
      }, async (requests) => {
        const flags = {
          token: "sk-test-auth",
          baseUrl: "https://unit.test/api/v1",
          noBrowser: true,
        };

        const login = await captureOutput(() => runLogin(flags));
        assert.match(login.stdout, /Authenticated as/);

        const whoami = await captureOutput(() => runWhoami({ baseUrl: flags.baseUrl }));
        assert.match(whoami.stdout, /Authenticated/);

        const doctor = await captureOutput(() => runDoctor({ baseUrl: flags.baseUrl }));
        assert.match(doctor.stdout, /All checks passed/);

        const logout = await captureOutput(() => runLogout());
        assert.match(logout.stdout, /API key removed/);
        assert.equal(requests.length, 3);
        assert.equal(process.exitCode, undefined);
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

test("completions and main cover shell metadata and top-level routing errors", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const bash = await captureOutput(() => runCompletions("bash"));
    assert.match(bash.stdout, /complete -F _qveris_completions qveris/);

    const zsh = await captureOutput(() => runCompletions("zsh"));
    assert.match(zsh.stdout, /#compdef qveris/);

    const fish = await captureOutput(() => runCompletions("fish"));
    assert.match(fish.stdout, /complete -c qveris/);

    const unsupported = await captureOutput(() => runCompletions("powershell"));
    assert.match(unsupported.stderr, /Supported shells/);
    assert.equal(process.exitCode, 2);

    process.exitCode = undefined;
    const version = await captureOutput(() => main(["node", "qveris", "--version"]));
    assert.match(version.stdout, /^qveris\/\d+\.\d+\.\d+/);

    const help = await captureOutput(() => main(["node", "qveris", "--help", "--no-color"]));
    assert.match(help.stdout, /Core Commands:/);

    const unknown = await captureOutput(() => main(["node", "qveris", "unknown"]));
    assert.match(unknown.stderr, /Unknown command: unknown/);
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = previousExitCode;
  }
});
