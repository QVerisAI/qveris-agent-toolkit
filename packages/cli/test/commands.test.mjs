import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveOAuthSession, deleteOAuthSession, loadOAuthSessionSecret } from "../src/auth/storage.mjs";
import { runAuth } from "../src/commands/auth.mjs";
import { runCall } from "../src/commands/call.mjs";
import { runCompletions } from "../src/commands/completions.mjs";
import { runConfig } from "../src/commands/config.mjs";
import { runCredits } from "../src/commands/credits.mjs";
import { runDiscover } from "../src/commands/discover.mjs";
import { runDoctor } from "../src/commands/doctor.mjs";
import { runExecutionLookup } from "../src/commands/execution.mjs";
import { runHistory } from "../src/commands/history.mjs";
import { runInspect } from "../src/commands/inspect.mjs";
import { runLedger } from "../src/commands/ledger.mjs";
import { runLogin, runLogout, runWhoami } from "../src/commands/login.mjs";
import { runProbe } from "../src/commands/probe.mjs";
import { runUsage } from "../src/commands/usage.mjs";
import { getConfigPath, setConfigValue } from "../src/config/store.mjs";
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
      headers: options.headers,
      body:
        options.body instanceof URLSearchParams
          ? Object.fromEntries(options.body)
          : options.body
            ? JSON.parse(options.body)
            : undefined,
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
    await withMockFetch(
      (request) => {
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
            model: "router-model-v1",
          });
          return response({
            execution_id: "exec-1",
            success: true,
            result: { data: { temperature: 18 } },
            billing: { summary: "3 credits" },
          });
        }
        throw new Error(`unexpected path ${request.url.pathname}`);
      },
      async () => {
        const flags = {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          json: true,
          timeout: "1",
        };

        const discover = await captureOutput(() => runDiscover("weather forecast", { ...flags, limit: "2" }));
        assert.equal(jsonFromStdout(discover.stdout).search_id, "search-1");
        const serializedSession = readFileSync(join(configDir, "qveris", ".session.json"), "utf-8");
        const session = JSON.parse(serializedSession);
        assert.equal(session.results[0].tool_id, "weather.tool.v1");
        assert.match(session.authorizationContext, /^v1:api-key:[a-f0-9]{64}$/);
        assert.equal(serializedSession.includes("sk-test"), false);

        const inspect = await captureOutput(() => runInspect(["1"], flags));
        assert.equal(jsonFromStdout(inspect.stdout).results[0].tool_id, "weather.tool.v1");

        const call = await captureOutput(() =>
          runCall("1", {
            ...flags,
            params: '{"city":"London"}',
            maxSize: "123",
            model: "router-model-v1",
          }),
        );
        assert.equal(jsonFromStdout(call.stdout).execution_id, "exec-1");

        const history = await captureOutput(() => runHistory({ json: true }));
        assert.equal(jsonFromStdout(history.stdout).discoveryId, "search-1");
        assert.equal(jsonFromStdout(history.stdout).authorizationContext, undefined);
      },
    );
  });
});

test("call dry-run validates resolved tool, params, and max size without network", async () => {
  await withTempConfig(async () => {
    let called = false;
    await withMockFetch(
      () => {
        called = true;
        return response({});
      },
      async () => {
        const output = await captureOutput(() =>
          runCall("tool.direct.v1", {
            apiKey: "sk-test",
            json: true,
            dryRun: true,
            params: '{"symbol":"AAPL"}',
            maxSize: "2048",
          }),
        );
        assert.equal(called, false);
        assert.deepEqual(jsonFromStdout(output.stdout), {
          dry_run: true,
          tool_id: "tool.direct.v1",
          discovery_id: null,
          parameters: { symbol: "AAPL" },
          max_response_size: 2048,
        });
      },
    );
  });
});

test("zero-quote CLI Call probes exact zero and fails closed before execute otherwise", async () => {
  await withTempConfig(async () => {
    const requests = [];
    await withMockFetch(
      (request) => {
        requests.push(request);
        if (request.url.pathname.endsWith("/tools/probe")) {
          return response({
            executable: true,
            execution_constraints_supported: ["require_zero_quote_v1"],
            schema: { valid: true },
            quote: { exact: true, estimate_credits: 0, currency: "credits" },
          });
        }
        if (request.url.pathname.endsWith("/tools/execute")) {
          assert.equal(request.body.require_zero_quote, true);
          return response({ execution_id: "exec-zero", success: true, result: { data: {} } });
        }
        throw new Error(`unexpected path ${request.url.pathname}`);
      },
      async () => {
        const result = await captureOutput(() =>
          runCall("tool-1", {
            apiKey: "sk-test",
            baseUrl: "https://unit.test/api/v1",
            discoveryId: "search-1",
            params: '{"city":"London"}',
            requireZeroQuote: true,
            json: true,
            timeout: "1",
          }),
        );
        assert.equal(jsonFromStdout(result.stdout).execution_id, "exec-zero");
      },
    );
    assert.deepEqual(
      requests.map((request) => request.url.pathname.split("/").pop()),
      ["probe", "execute"],
    );

    let executed = false;
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/tools/probe")) {
          return response({
            executable: true,
            execution_constraints_supported: ["require_zero_quote_v1"],
            schema: { valid: true },
            quote: { exact: true, estimate_credits: 2, currency: "credits" },
          });
        }
        if (request.url.pathname.endsWith("/tools/execute")) executed = true;
        return response({});
      },
      async () => {
        await assert.rejects(
          runCall("tool-1", {
            apiKey: "sk-test",
            baseUrl: "https://unit.test/api/v1",
            discoveryId: "search-1",
            params: "{}",
            requireZeroQuote: true,
            json: true,
            timeout: "1",
          }),
          /exact zero-credit quote/,
        );
      },
    );
    assert.equal(executed, false);

    let unsupportedExecuted = false;
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/tools/probe")) {
          return response({
            executable: true,
            execution_constraints_supported: [],
            schema: { valid: true },
            quote: { exact: true, estimate_credits: 0, currency: "credits" },
          });
        }
        if (request.url.pathname.endsWith("/tools/execute")) unsupportedExecuted = true;
        return response({});
      },
      async () => {
        await assert.rejects(
          runCall("tool-1", {
            apiKey: "sk-test",
            baseUrl: "https://unit.test/api/v1",
            discoveryId: "search-1",
            params: "{}",
            requireZeroQuote: true,
            json: true,
            timeout: "1",
          }),
          /exact zero-credit quote/,
        );
      },
    );
    assert.equal(unsupportedExecuted, false);
  });
});

test("HTTP 409 with an execution_id stays a key conflict and never reconciles an older result", async () => {
  await withTempConfig(async () => {
    await withMockFetch(
      (request) => {
        assert.equal(request.method, "POST");
        assert.equal(request.url.pathname, "/api/v1/tools/execute");
        return new Response(
          JSON.stringify({
            message: "Idempotency-Key conflicts with an earlier request",
            execution_id: "exec-from-earlier-request",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
      async (requests) => {
        const previousExitCode = process.exitCode;
        let output;
        try {
          output = await captureOutput(() =>
            main([
              "node",
              "qveris",
              "call",
              "tool-1",
              "--api-key",
              "sk-test",
              "--base-url",
              "https://unit.test/api/v1",
              "--discovery-id",
              "search-1",
              "--params",
              "{}",
              "--idempotency-key",
              "conflicting-key",
              "--json",
            ]),
          );
        } finally {
          process.exitCode = previousExitCode;
        }
        const error = JSON.parse(output.stderr);
        assert.equal(error.status, 409);
        assert.equal(error.idempotency_key, "conflicting-key");
        assert.equal(error.action, "lookup_execution");
        assert.equal(error.next_action.reason, "idempotency_key_conflict");
        assert.equal(error.success, undefined);
        assert.equal(error.responseData, undefined);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].headers["Idempotency-Key"], "conflicting-key");
      },
    );
  });
});

test("execution lookup command performs a single read-only GET", async () => {
  await withMockFetch(
    (request) => {
      assert.equal(request.method, "GET");
      assert.equal(request.url.pathname, "/api/v1/tools/executions/by-idempotency-key");
      assert.equal(request.url.searchParams.get("key"), "retained-key");
      return response({ status: "pending" });
    },
    async () => {
      const output = await captureOutput(() =>
        runExecutionLookup("retained-key", {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          json: true,
        }),
      );
      assert.deepEqual(jsonFromStdout(output.stdout), { status: "pending" });
    },
  );
});

test("CLI accepts a stable idempotency key and exposes execution lookup routing", async () => {
  await withTempConfig(async () => {
    const requests = [];
    await withMockFetch(
      (request) => {
        requests.push(request);
        if (request.url.pathname.endsWith("/tools/execute")) {
          assert.equal(request.headers["Idempotency-Key"], "stable-key");
          const body = request.body;
          assert.equal(body.idempotency_key, undefined);
          assert.deepEqual(body.parameters, { city: "London" });
          return response({ execution_id: "exec-1", success: true, result: { data: {} } });
        }
        if (request.url.pathname.endsWith("/tools/executions/by-idempotency-key")) {
          assert.equal(request.method, "GET");
          assert.equal(request.url.searchParams.get("key"), "stable-key");
          return response({ status: "completed", execution_id: "exec-1" });
        }
        throw new Error(`unexpected path ${request.url.pathname}`);
      },
      async () => {
        await captureOutput(() =>
          main([
            "node",
            "qveris",
            "call",
            "tool-1",
            "--api-key",
            "sk-test",
            "--base-url",
            "https://unit.test/api/v1",
            "--discovery-id",
            "search-1",
            "--params",
            '{"city":"London"}',
            "--idempotency-key",
            "stable-key",
            "--json",
          ]),
        );
        const lookup = await captureOutput(() =>
          main([
            "node",
            "qveris",
            "execution",
            "lookup",
            "stable-key",
            "--api-key",
            "sk-test",
            "--base-url",
            "https://unit.test/api/v1",
            "--json",
          ]),
        );
        assert.deepEqual(jsonFromStdout(lookup.stdout), { status: "completed", execution_id: "exec-1" });
      },
    );
    assert.deepEqual(
      requests.map(({ method }) => method),
      ["POST", "GET"],
    );
  });
});

test("session shortcuts fail closed across endpoints and authorization contexts", async () => {
  await withTempConfig(async () => {
    let networkCalls = 0;
    await withMockFetch(
      (request) => {
        networkCalls += 1;
        if (request.url.pathname.endsWith("/search")) {
          return response({
            search_id: "search-a",
            results: [{ tool_id: "weather.tool.v1", name: "Weather" }],
          });
        }
        throw new Error(`unexpected network call ${request.url}`);
      },
      async () => {
        await captureOutput(() =>
          runDiscover("weather", {
            apiKey: "<fixture-account-a>",
            baseUrl: "https://a.test/api/v1",
            json: true,
          }),
        );
        assert.equal(networkCalls, 1);

        const mismatchedCommands = [
          () =>
            runCall("1", {
              apiKey: "<fixture-account-a>",
              baseUrl: "https://b.test/api/v1",
              discoveryId: "explicit-search",
              params: "{}",
              dryRun: true,
              json: true,
            }),
          () =>
            runCall("weather.tool.v1", {
              apiKey: "<fixture-account-b>",
              baseUrl: "https://a.test/api/v1",
              params: "{}",
              dryRun: true,
              json: true,
            }),
          () =>
            runInspect(["1"], {
              apiKey: "<fixture-account-b>",
              baseUrl: "https://a.test/api/v1",
              discoveryId: "explicit-search",
              json: true,
            }),
          () =>
            runProbe("1", {
              apiKey: "<fixture-account-a>",
              baseUrl: "https://b.test/api/v1",
              json: true,
            }),
        ];
        for (const command of mismatchedCommands) {
          await assert.rejects(
            command,
            (error) =>
              error?.code === "SESSION_EXPIRED" && /another API endpoint or authorization context/.test(error.message),
          );
        }
        assert.equal(networkCalls, 1);

        const explicit = await captureOutput(() =>
          runCall("weather.tool.v1", {
            apiKey: "<fixture-account-b>",
            baseUrl: "https://b.test/api/v1",
            discoveryId: "search-b",
            params: "{}",
            dryRun: true,
            json: true,
          }),
        );
        assert.equal(jsonFromStdout(explicit.stdout).discovery_id, "search-b");
        assert.equal(networkCalls, 1);
      },
    );
  });
});

test("credits, usage, and ledger commands cover account audit interfaces", async () => {
  await withTempConfig(async () => {
    await withMockFetch(
      (request) => {
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
      },
      async () => {
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
      },
    );
  });
});

test("config command covers set, get, list, path, and reset", async () => {
  await withTempConfig(async () => {
    const set = await captureOutput(() => runConfig("set", ["api_key", "sk-config"], { json: true }));
    assert.deepEqual(jsonFromStdout(set.stdout), { key: "api_key", value: "sk-config" });

    const get = await captureOutput(() => runConfig("get", ["api_key"], { json: true }));
    assert.deepEqual(jsonFromStdout(get.stdout), { key: "api_key", value: "sk-config" });

    setConfigValue("oauth_session_secret", {
      secret: { access_token: "<never-access>", refresh_token: "<never-refresh>" },
    });
    const previousSecretExitCode = process.exitCode;
    process.exitCode = undefined;
    const secretGet = await captureOutput(() => runConfig("get", ["oauth_session_secret"], { json: true }));
    assert.match(secretGet.stderr, /Unknown config key: oauth_session_secret/);
    assert.doesNotMatch(`${secretGet.stdout}${secretGet.stderr}`, /never-print/);
    assert.equal(process.exitCode, 2);
    process.exitCode = previousSecretExitCode;

    const list = await captureOutput(() => runConfig("list", [], { json: true }));
    const listed = jsonFromStdout(list.stdout);
    assert.equal(listed.api_key.value, "***");
    assert.equal(listed.base_url, undefined);
    assert.equal(listed._endpoint.base_url, "https://qveris.ai/api/v1");

    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const unsupportedBaseUrl = await captureOutput(() => runConfig("set", ["base_url", "https://unit.test"], {}));
    assert.match(unsupportedBaseUrl.stderr, /Unknown config key: base_url/);
    assert.equal(process.exitCode, 2);
    process.exitCode = previousExitCode;

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
      await withMockFetch(
        (request) => {
          assert.equal(request.url.pathname, "/api/v1/search");
          assert.deepEqual(request.body, { query: "test", limit: 1 });
          return response({ search_id: "search-ok", results: [] });
        },
        async (requests) => {
          const flags = {
            token: "<fixture-auth-token>",
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
        },
      );
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
    assert.match(help.stdout, /QVERIS_BASE_URL\s+Override API base URL/);
    assert.doesNotMatch(help.stdout, /QVERIS_REGION|key prefix|\(global\)|\bChina\b|中国区|全球区/);
    assert.equal((help.stdout.match(/https:\/\/qveris\.(?:ai|cn)/g) || []).length, 1);

    const unknown = await captureOutput(() => main(["node", "qveris", "unknown"]));
    assert.match(unknown.stderr, /Unknown command: unknown/);
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("main accepts separate idempotency-key values for Call and reconciliation", async () => {
  await withTempConfig(async () => {
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/tools/execute")) {
          return response({ execution_id: "exec-cli", success: true, result: { ok: true } });
        }
        if (request.url.pathname.endsWith("/tools/executions/by-idempotency-key")) {
          return response({ status: "completed", execution_id: "exec-cli", response: { success: true } });
        }
        throw new Error(`unexpected network call ${request.url}`);
      },
      async (requests) => {
        await captureOutput(() =>
          main([
            "node",
            "qveris",
            "call",
            "tool.direct.v1",
            "--api-key",
            "sk-test",
            "--base-url",
            "https://unit.test/api/v1",
            "--params",
            "{}",
            "--idempotency-key",
            "call-key-1",
            "--json",
          ]),
        );
        assert.equal(requests[0].headers["Idempotency-Key"], "call-key-1");

        await captureOutput(() =>
          main([
            "node",
            "qveris",
            "reconcile-call",
            "--api-key",
            "sk-test",
            "--base-url",
            "https://unit.test/api/v1",
            "--idempotency-key",
            "call-key-1",
            "--json",
          ]),
        );
        assert.equal(requests[1].url.searchParams.get("key"), "call-key-1");
      },
    );
  });
});

test("successful execution with a settlement review requires manual action without replay", async () => {
  const previousExitCode = process.exitCode;
  const review = {
    execution_status: "executed",
    settlement_status: "review_required",
    reason_code: "settlement.zero_quote_actual_positive",
    quoted_amount_credits: "0",
    reported_actual_amount_credits: "1",
    user_charge_amount_credits: "0",
    settlement_owner: "billing",
    retryable: false,
    next_action: "manual_settlement_review",
  };
  try {
    process.exitCode = undefined;
    await withTempConfig(async () => {
      await withMockFetch(
        (request) => {
          assert.equal(request.method, "POST");
          assert.ok(request.url.pathname.endsWith("/tools/execute"));
          return response({
            execution_id: "exec-review",
            success: true,
            result: { data: { ok: true } },
            settlement_review: review,
          });
        },
        async (requests) => {
          const output = await captureOutput(() =>
            runCall("tool-fixture", { apiKey: "<fixture-key>", discoveryId: "search-1", params: "{}", json: true }),
          );
          const data = jsonFromStdout(output.stdout);
          assert.equal(data.success, true);
          assert.equal(data.execution_id, "exec-review");
          assert.deepEqual(data.settlement_review, review);
          assert.deepEqual(data.next_action, {
            action: "manual_settlement_review",
            automatic: false,
            requires_user: true,
            missing_fields: [],
            reason: review.reason_code,
          });
          assert.equal(data.recovery.retryable, false);
          assert.equal(requests.length, 1);
          assert.equal(process.exitCode, 1);
        },
      );
    });
  } finally {
    process.exitCode = previousExitCode;
  }
});

for (const [failure, code, exitCode] of [
  [401, "AUTH_INVALID_KEY", 77],
  [403, "PERMISSION_DENIED", 77],
  [402, "CREDITS_INSUFFICIENT", 77],
  [429, "RATE_LIMITED", 75],
  [500, "SERVICE_UNAVAILABLE", 75],
  [503, "SERVICE_UNAVAILABLE", 75],
  ["network", "NET_CONNECTION", 75],
  ["timeout", "NET_TIMEOUT", 75],
]) {
  test(`auth validation classifies ${failure}, preserves stored key, and emits secret-free JSON`, async () => {
    await withTempConfig(async () => {
      const previousExit = process.exitCode;
      const previousRetries = process.env.QVERIS_MAX_RETRIES;
      process.env.QVERIS_MAX_RETRIES = "0";
      const oldKey = "<fixture-existing-credential>";
      const candidate = "<fixture-candidate-credential>";
      setConfigValue("api_key", oldKey);
      try {
        await withMockFetch(
          () => {
            if (failure === "network") throw new TypeError(candidate);
            if (failure === "timeout") throw new DOMException(candidate, "AbortError");
            return new Response(JSON.stringify({ message: candidate }), { status: failure });
          },
          async () => {
            for (const command of ["login", "whoami", "doctor"]) {
              process.exitCode = undefined;
              const args = ["node", "qveris", command, "--json", "--base-url", "https://qveris.cn/api/v1"];
              if (command === "login") args.push("--token", candidate);
              const result = await captureOutput(() => main(args));
              assert.equal(process.exitCode, exitCode);
              assert.doesNotMatch(result.stdout + result.stderr, new RegExp(candidate));
              assert.doesNotMatch(result.stdout + result.stderr, new RegExp(oldKey));
              if (command === "doctor") {
                const diagnostic = JSON.parse(result.stdout).checks.find((check) => check.status === "fail");
                assert.equal(diagnostic.code, code);
                assert.equal(diagnostic.http_status, typeof failure === "number" ? failure : undefined);
              } else {
                assert.equal(result.stdout, "");
                const diagnostic = JSON.parse(result.stderr);
                assert.equal(diagnostic.code, code);
                assert.equal(diagnostic.status, typeof failure === "number" ? failure : undefined);
                assert.equal(diagnostic.credential.source, command === "login" ? "flag (--token)" : "config");
                assert.equal(diagnostic.credential.endpoint, "https://qveris.cn/api/v1");
              }
            }
            assert.equal(JSON.parse(readFileSync(getConfigPath(), "utf8")).api_key, oldKey);
          },
        );
      } finally {
        process.exitCode = previousExit;
        if (previousRetries === undefined) delete process.env.QVERIS_MAX_RETRIES;
        else process.env.QVERIS_MAX_RETRIES = previousRetries;
      }
    });
  });
}

test("login JSON is a single secret-free result and whoami reports credential precedence", async () => {
  await withTempConfig(async () => {
    await withMockFetch(
      () => response({ search_id: "s", results: [], remaining_credits: 0 }),
      async (requests) => {
        const login = await captureOutput(() => runLogin({ token: "short", json: true }));
        assert.equal(login.stderr, "");
        assert.deepEqual(JSON.parse(login.stdout), {
          authenticated: true,
          type: "api_key",
          source: "flag (--token)",
          endpoint: "https://qveris.ai/api/v1",
          endpoint_source: "default",
          saved_to: "config",
        });
        process.env.QVERIS_API_KEY = "<fixture-env-key>";
        const whoami = await captureOutput(() => runWhoami({ apiKey: "<fixture-flag-key>", json: true }));
        assert.equal(JSON.parse(whoami.stdout).source, "flag");
        assert.equal(requests.at(-1).headers.Authorization, "Bearer <fixture-flag-key>");
        const env = await captureOutput(() => runWhoami({ json: true }));
        assert.equal(JSON.parse(env.stdout).source, "env (QVERIS_API_KEY)");
        assert.equal(requests.at(-1).headers.Authorization, "Bearer <fixture-env-key>");
      },
    );
  });
});

test("missing credentials recommend only delivered authentication commands", async () => {
  await withTempConfig(async () => {
    const previousExit = process.exitCode;
    try {
      const result = await captureOutput(() => main(["node", "qveris", "whoami", "--json"]));
      const error = JSON.parse(result.stderr);
      assert.equal(error.code, "AUTH_MISSING_KEY");
      assert.equal(process.exitCode, 78);
      assert.match(error.hint, /auth login.*OAuth Device Flow/);
      assert.match(error.hint, /qveris login.*paste an API key/);
      assert.doesNotMatch(error.hint, /auth trial/);
    } finally {
      process.exitCode = previousExit;
    }
  });
});

test("OAuth whoami uses the stored endpoint and transient diagnostics retain the session", async () => {
  await withTempConfig(async () => {
    const previousExit = process.exitCode;
    const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
    const previousRetries = process.env.QVERIS_MAX_RETRIES;
    process.env.QVERIS_DISABLE_KEYRING = "1";
    process.env.QVERIS_MAX_RETRIES = "0";
    const secret = { access_token: "<fixture-oauth-access>", refresh_token: "<fixture-oauth-refresh>" };
    try {
      await saveOAuthSession(
        {
          issuer: "https://unit.test",
          api_base_url: "https://unit.test/api/v1",
          resource: "https://unit.test/tools",
          scope: "tools.search offline_access",
          expires_at: Date.now() + 3600000,
        },
        secret,
        { allowUnencryptedStorage: true },
      );
      await withMockFetch(
        () => response({ search_id: "oauth-search", results: [] }),
        async (requests) => {
          const identity = await captureOutput(() => runWhoami({ json: true }));
          assert.equal(JSON.parse(identity.stdout).type, "oauth");
          assert.equal(JSON.parse(identity.stdout).source, "oauth session");
          assert.equal(JSON.parse(identity.stdout).endpoint_source, "oauth session");
          assert.equal(requests[0].url.origin, "https://unit.test");
          assert.equal(requests[0].headers.Authorization, `Bearer ${secret.access_token}`);
        },
      );
      for (const [failure, code, exitCode] of [
        [403, "PERMISSION_DENIED", 77],
        [429, "RATE_LIMITED", 75],
        [503, "SERVICE_UNAVAILABLE", 75],
        ["network", "NET_CONNECTION", 75],
        ["timeout", "NET_TIMEOUT", 75],
      ]) {
        await withMockFetch(
          () => {
            if (failure === "network") throw new TypeError(secret.access_token);
            if (failure === "timeout") throw new DOMException(secret.access_token, "AbortError");
            return new Response(JSON.stringify({ message: secret.access_token }), { status: failure });
          },
          async () => {
            for (const command of ["whoami", "status"]) {
              const result = await captureOutput(() =>
                command === "whoami" ? runWhoami({ json: true }) : runAuth("status", { json: true }),
              );
              const diagnostic = JSON.parse(command === "whoami" ? result.stderr : result.stdout);
              assert.equal(diagnostic.code, code);
              assert.equal(process.exitCode, exitCode);
              assert.doesNotMatch(result.stdout + result.stderr, /fixture-oauth/);
              assert.deepEqual(await loadOAuthSessionSecret(), secret);
            }
          },
        );
      }
    } finally {
      await deleteOAuthSession();
      process.exitCode = previousExit;
      if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
      else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
      if (previousRetries === undefined) delete process.env.QVERIS_MAX_RETRIES;
      else process.env.QVERIS_MAX_RETRIES = previousRetries;
    }
  });
});

test("expired and challenged OAuth sessions preserve refresh failure classification without replay", async () => {
  await withTempConfig(async () => {
    const previousExit = process.exitCode;
    const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
    process.env.QVERIS_DISABLE_KEYRING = "1";
    const secret = { access_token: "<fixture-refresh-access>", refresh_token: "<fixture-refresh-secret>" };
    try {
      for (const expired of [true, false]) {
        await saveOAuthSession(
          {
            issuer: "https://unit.test",
            api_base_url: "https://unit.test/api/v1",
            token_endpoint: "https://unit.test/oauth/token",
            resource: "https://unit.test/tools",
            scope: "tools.search offline_access",
            expires_at: Date.now() + (expired ? -1000 : 3600000),
          },
          secret,
          { allowUnencryptedStorage: true },
        );
        for (const [failure, code, exitCode] of [
          [429, "RATE_LIMITED", 75],
          [503, "SERVICE_UNAVAILABLE", 75],
          [400, "AUTH_OAUTH_FAILED", 77],
          ["network", "NET_CONNECTION", 75],
          ["timeout", "NET_TIMEOUT", 75],
        ]) {
          await withMockFetch(
            (request) => {
              if (request.url.pathname.endsWith("/search")) return new Response("{}", { status: 401 });
              assert.equal(request.url.pathname, "/oauth/token");
              if (failure === "network") throw new TypeError(secret.refresh_token);
              if (failure === "timeout") throw new DOMException(secret.refresh_token, "AbortError");
              return new Response(
                failure === 400 ? JSON.stringify({ error: "invalid_grant" }) : "<html>gateway failure</html>",
                { status: failure },
              );
            },
            async (requests) => {
              for (const command of ["whoami", "status", "doctor"]) {
                const offset = requests.length;
                const result = await captureOutput(() =>
                  command === "whoami"
                    ? runWhoami({ json: true })
                    : command === "doctor"
                      ? runDoctor({ json: true })
                      : runAuth("status", { json: true }),
                );
                const output = JSON.parse(command === "whoami" ? result.stderr : result.stdout);
                const diagnostic = command === "doctor" ? output.checks.find((c) => c.status === "fail") : output;
                assert.equal(diagnostic.code, code);
                assert.equal(process.exitCode, exitCode);
                assert.equal(requests.slice(offset).filter((r) => r.url.pathname === "/oauth/token").length, 1);
                assert.doesNotMatch(result.stdout + result.stderr, /fixture-refresh|gateway failure/);
                assert.deepEqual(await loadOAuthSessionSecret(), secret);
              }
            },
          );
        }
      }
    } finally {
      await deleteOAuthSession();
      process.exitCode = previousExit;
      if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
      else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
    }
  });
});
