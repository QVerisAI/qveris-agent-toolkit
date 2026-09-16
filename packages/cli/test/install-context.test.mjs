import assert from "node:assert/strict";
import test from "node:test";

import { runCall } from "../src/commands/call.mjs";
import { CliError } from "../src/errors/handler.mjs";
import { outputJsonError } from "../src/output/json.mjs";
import { assertInstallContextCurrent, parseInstallContext } from "../src/utils/install-context.mjs";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const TEST_API_KEY = ["sk", "test"].join("-");
const SENSITIVE_API_KEY_FIELD = ["api", "key"].join("_");
const fixtureValue = (...parts) => parts.join("");

function context(overrides = {}) {
  return JSON.stringify({
    context_version: 1,
    context_issued_at: NOW_SECONDS - 60,
    context_expires_at: NOW_SECONDS + 600,
    task_id: "company-latest-filing",
    service_id: "service.market-data.v1",
    tool_id: "provider.company.lookup.v1",
    template_id: "filing-summary.v1",
    ...overrides,
  });
}

function liveContext(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    context_version: 1,
    context_issued_at: now - 60,
    context_expires_at: now + 600,
    task_id: "company-latest-filing",
    service_id: "service.market-data.v1",
    tool_id: "provider.company.lookup.v1",
    ...overrides,
  });
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = {
      url: new URL(url),
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    requests.push(request);
    return handler(request, requests);
  };
  return Promise.resolve()
    .then(() => fn(requests))
    .finally(() => {
      globalThis.fetch = original;
    });
}

async function captureOutput(fn) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = function write(chunk, ...args) {
    chunks.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

function captureErrorOutput(fn) {
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = function write(chunk, ...args) {
    chunks.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join("");
}

test("v1 parser accepts public IDs and negotiates forward-compatible fields", () => {
  const parsed = parseInstallContext(
    context({
      future_display_hint: "compact",
      extensions: { "example.ui": { color: "blue" } },
      context_capabilities: ["warnings_v1", "future_optional_capability"],
      context_required_capabilities: ["refresh_on_expiry"],
    }),
    NOW_MS,
  );
  assert.equal(parsed.version, 1);
  assert.equal(parsed.taskId, "company-latest-filing");
  assert.equal(parsed.stale, false);
  assert.deepEqual(
    parsed.warnings.map((warning) => warning.code),
    ["CONTEXT_FIELD_IGNORED", "CONTEXT_CAPABILITY_IGNORED"],
  );
  assert.equal(
    parseInstallContext(context({ task_id: "0123456789abcdef0123456789abcdef" }), NOW_MS).taskId,
    "0123456789abcdef0123456789abcdef",
  );
});

test("v1 parser marks expired snapshots stale but rejects invalid time and unsupported requirements", () => {
  const expired = parseInstallContext(context({ context_expires_at: NOW_SECONDS }), NOW_MS);
  assert.equal(expired.stale, true);
  assert.equal(expired.warnings[0].code, "CONTEXT_SNAPSHOT_EXPIRED");
  assert.throws(
    () =>
      parseInstallContext(
        context({ context_issued_at: NOW_SECONDS + 301, context_expires_at: NOW_SECONDS + 600 }),
        NOW_MS,
      ),
    (error) => error instanceof CliError && error.code === "CONTEXT_INVALID" && /timestamps/.test(error.message),
  );
  for (const version of [0, 2]) {
    assert.throws(
      () => parseInstallContext(context({ context_version: version }), NOW_MS),
      (error) => error instanceof CliError && error.code === "CONTEXT_UNSUPPORTED",
    );
  }
  const forwardCompatible = parseInstallContext(
    context({ context_version: 2, context_min_consumer_version: 1 }),
    NOW_MS,
  );
  assert.equal(forwardCompatible.version, 2);
  assert.ok(forwardCompatible.warnings.some((warning) => warning.code === "CONTEXT_VERSION_FORWARD_COMPAT"));
  assert.throws(
    () => parseInstallContext(context({ context_required_capabilities: ["future_required"] }), NOW_MS),
    (error) => error instanceof CliError && error.code === "CONTEXT_UNSUPPORTED",
  );
});

test("context lifetime can be checked without turning snapshot expiry into authorization", () => {
  const parsed = parseInstallContext(context(), NOW_MS);
  assert.equal(assertInstallContextCurrent(parsed, NOW_MS), true);
  assert.equal(assertInstallContextCurrent(parsed, (NOW_SECONDS + 600) * 1000), false);
});

test("v1 parser rejects duplicate, credential, PII, payload, and prototype fields without echoing values", () => {
  const embeddedCredentials = [
    fixtureValue("token ", fixtureValue("sk-", "abcdefghijklmnopqrstuv")),
    fixtureValue("token ", fixtureValue("ghp_", "abcdefghijklmnopqrst")),
    fixtureValue("token ", fixtureValue("xoxb-", "abcdefghijklmnop")),
    fixtureValue("token ", fixtureValue("AKIA", "ABCDEFGHIJKLMNOP")),
    fixtureValue("token ", fixtureValue("AIza", "abcdefghijklmnopqrst")),
    fixtureValue("token ", fixtureValue("Bearer ", "abcdefghijklmnopqrstuvwxyz")),
    fixtureValue("token ", fixtureValue("eyJabc.", "def.", "ghi")),
  ];
  const unsafe = [
    context({ prompt: "private-customer-request" }),
    context({ service_id: "service:sk-abcdefghijklmnopqrstuv" }),
    context({ task_id: "123-45-6789" }),
    context({ task_id: "operator@example.com" }),
    context({ task_id: "13800138000" }),
    context({ task_id: "11010519491231002X" }),
    context({ task_id: "4111111111111111" }),
    context({ task_id: "GB82WEST12345698765432" }),
    ...embeddedCredentials.map((value) => context({ extensions: { "example.data": { note: value } } })),
    context({ future_display_hint: fixtureValue("prefix: Bearer ", "abcdefghijklmnopqrstuvwxyz; suffix") }),
    context({ extensions: { "example.data": { note: "contact operator@example.com" } } }),
    context({ extensions: { "example.data": { note: "ssn 123-45-6789" } } }),
    context({ extensions: { "example.data": { note: "card 4111111111111111" } } }),
    context({ extensions: { "example.data": { [SENSITIVE_API_KEY_FIELD]: "not-echoed" } } }),
    context({ extensions: { "example.data": JSON.parse('{"__proto__":{"polluted":true}}') } }),
  ];
  for (const raw of unsafe) {
    assert.throws(
      () => parseInstallContext(raw, NOW_MS),
      (error) => error instanceof CliError && error.code === "CONTEXT_UNSAFE",
    );
  }

  assert.doesNotThrow(() =>
    parseInstallContext(context({ extensions: { "example.data": { note: "Bearer brief" } } }), NOW_MS),
  );

  const duplicate = context().replace(
    '"task_id":"company-latest-filing"',
    '"task_id":"company-latest-filing","task_id":"other-task"',
  );
  assert.throws(
    () => parseInstallContext(duplicate, NOW_MS),
    (error) => error instanceof CliError && error.code === "CONTEXT_UNSAFE" && /duplicate/.test(error.message),
  );
  assert.throws(
    () => parseInstallContext(context({ context_version: 2, service_id: "service:sk-abcdefghijklmnopqrstuv" }), NOW_MS),
    (error) => error instanceof CliError && error.code === "CONTEXT_UNSAFE",
  );

  const nestedDuplicate = context().replace(
    /}$/,
    ',"extensions":{"example.data":{"api_key":"not-echoed","api\\u005fkey":{}}}}',
  );
  assert.throws(
    () => parseInstallContext(nestedDuplicate, NOW_MS),
    (error) => error instanceof CliError && error.code === "CONTEXT_UNSAFE" && /duplicate/.test(error.message),
  );
});

test("v1 parser rejects deeply nested untrusted fields without exhausting the stack", () => {
  const nested = [];
  let cursor = nested;
  for (let depth = 0; depth <= 64; depth += 1) {
    const child = [];
    cursor.push(child);
    cursor = child;
  }
  for (const raw of [context({ future_display_hint: nested }), context({ extensions: { "example.deep": nested } })]) {
    assert.throws(
      () => parseInstallContext(raw, NOW_MS),
      (error) =>
        error instanceof CliError && error.code === "CONTEXT_UNSAFE" && /nested too deeply/.test(error.message),
    );
  }
});

test("context call tolerates absent execution-safety metadata and remains single-submit", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "symbol", type: "string", required: true, description: "ticker" }],
              expected_cost: 0,
              billing_rule: { price: { amount_credits: 0 } },
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({ execution_id: "exec-safe", success: true, result: { symbol: "AAPL" } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.success, true);
      assert.deepEqual(
        result.context_handoff.warnings.map((warning) => warning.code),
        ["SIDE_EFFECT_METADATA_ABSENT", "IDEMPOTENCY_METADATA_ABSENT"],
      );
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search", "/api/v1/tools/execute"],
      );
      assert.deepEqual(requests[0].body, {
        query: "provider.company.lookup.v1",
        limit: 100,
      });
    },
  );
});

test("context dry runs bypass execution-only safety checks without submitting a call", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "symbol", type: "string", required: true }],
              expected_cost: 0,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ future_display_hint: "compact" }),
          params: '{"symbol":"AAPL"}',
          dryRun: true,
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.dry_run, true);
      assert.equal(result.tool_id, "provider.company.lookup.v1");
      assert.deepEqual(result.context_handoff, {
        status: "refreshed",
        stale_input: false,
        warnings: [{ code: "CONTEXT_FIELD_IGNORED", field: "future_display_hint", action: "ignored" }],
        validation_steps: ["discover"],
        price_status: "free",
      });
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search"],
      );
    },
  );
});

test("context call preserves permission failures", async () => {
  await withMockFetch(
    () => response({ message: "missing required scope" }, 403),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "PERMISSION_DENIED",
      );
      assert.equal(requests.length, 1);
    },
  );
});

test("context call stops after exact and service rediscovery find no safe fallback", async () => {
  await withMockFetch(
    () => response({ search_id: "fresh-search", results: [] }),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_REDISCOVERY_FAILED",
      );
      assert.equal(requests.length, 2);
    },
  );
});

test("expired context refreshes and continues unknown price without redundant probe", async () => {
  const now = Math.floor(Date.now() / 1000);
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "refreshed-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "symbol", type: "string", required: true, description: "ticker" }],
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({ execution_id: "exec-refreshed", success: true, result: { symbol: "AAPL" } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ context_issued_at: now - 120, context_expires_at: now - 1 }),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.success, true);
      assert.ok(result.context_handoff.warnings.some((warning) => warning.code === "PRICE_UNKNOWN"));
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search", "/api/v1/tools/execute"],
      );
    },
  );
});

test("quote is a gate only when quote policy requires it", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "symbol", type: "string", required: true, description: "ticker" }],
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/probe")) return response({ schema: { valid: true } });
      throw new Error("Call must not execute without the required quote");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          requireQuote: true,
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_QUOTE_REQUIRED",
      );
      assert.deepEqual(requests[1].body.checks, ["quote"]);
    },
  );
});

test("context calls reject a requested hard budget before any remote request", async () => {
  await withMockFetch(
    () => {
      throw new Error("Context budget rejection must happen before any remote request");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          maxCredits: "2",
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_BUDGET_UNSUPPORTED",
      );
      assert.equal(requests.length, 0);
    },
  );
});

test("human-readable paid pricing requires a current quote", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [],
              expected_cost: "5 credits per successful request",
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/probe")) return response({});
      throw new Error("Call must not execute without a quote for paid risk");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_QUOTE_REQUIRED",
      );
      assert.deepEqual(requests[1].body.checks, ["quote"]);
      assert.equal(requests.length, 2);
    },
  );
});

test("partially understood billing rules require a current quote", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [],
              billing_rule: { amount_credits: 0, future_component: 5 },
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/probe")) return response({});
      throw new Error("Call must not execute without a quote for an incomplete billing rule");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          dryRun: true,
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_QUOTE_REQUIRED",
      );
      assert.deepEqual(requests[1].body.checks, ["quote"]);
      assert.equal(requests.length, 2);
    },
  );
});

test("integer parameters use JSON integer semantics before execution", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "count", type: "integer", required: true }],
              expected_cost: 0,
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) return response({ success: true, result: { count: 2 } });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"count":2}',
          json: true,
        }),
      );
      assert.equal(JSON.parse(output).success, true);
      assert.equal(requests.length, 2);
    },
  );
});

test("fallback without explicit service identity remains a user selection", async () => {
  await withMockFetch(
    () =>
      response({
        search_id: "fresh-search",
        results: [{ tool_id: "provider.fallback.v1", provider_id: "fallback" }],
      }),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) =>
          error instanceof CliError &&
          error.code === "CONTEXT_REDISCOVERY_FAILED" &&
          error.fallbackAvailable === true &&
          error.candidates[0].tool_id === "provider.fallback.v1",
      );
      assert.equal(requests.length, 2);
    },
  );
});

test("JSON errors expose one machine-readable recovery contract", () => {
  const error = new CliError("CONTEXT_REDISCOVERY_FAILED", "tool changed");
  error.retryable = false;
  error.action = "select_fallback";
  error.candidates = [{ tool_id: "provider.fallback.v1", provider_id: "fallback" }];
  error.fallbackAvailable = true;
  const result = JSON.parse(captureErrorOutput(() => outputJsonError(error, 69)));
  assert.deepEqual(result, {
    error: "tool changed",
    code: "CONTEXT_REDISCOVERY_FAILED",
    hint: "Select a returned current candidate or broaden discovery; do not force the old tool ID",
    retryable: false,
    action: "select_fallback",
    next_action: {
      action: "select_fallback",
      automatic: false,
      requires_user: true,
      missing_fields: [],
    },
    missing_fields: [],
    fallback_available: true,
    candidates: [{ tool_id: "provider.fallback.v1", provider_id: "fallback" }],
    exit_code: 69,
  });
});

test("confirmation flags do not create risk when execution-safety metadata is absent", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [],
              expected_cost: 0,
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) return response({ success: true, result: {} });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          allowSideEffects: true,
          allowNonIdempotent: true,
          json: true,
        }),
      );
      assert.equal(JSON.parse(output).success, true);
      assert.equal(requests.length, 2);
    },
  );
});

test("explicit dangerous or non-idempotent execution still requires confirmation", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [],
              expected_cost: 0,
              dangerous_side_effects: true,
              idempotent: false,
            },
          ],
        });
      }
      throw new Error("Explicit risk must block before Call");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_EXECUTION_BLOCKED",
      );
      assert.equal(requests.length, 1);
    },
  );
});

test("one current same-service candidate is validated and used as a safe pre-call fallback", async () => {
  let searches = 0;
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        searches += 1;
        if (searches === 1) return response({ search_id: "exact-search", results: [] });
        return response({
          search_id: "service-search",
          results: [
            {
              tool_id: "provider.company.lookup.fallback.v1",
              service_id: "service.market-data.v1",
              provider_id: "fallback",
              params: [{ name: "symbol", type: "string", required: true }],
              expected_cost: 0,
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        assert.equal(request.url.searchParams.get("tool_id"), "provider.company.lookup.fallback.v1");
        return response({ execution_id: "exec-fallback", success: true, result: { symbol: "AAPL" } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.success, true);
      assert.deepEqual(result.context_handoff.fallback, {
        from_tool_id: "provider.company.lookup.v1",
        to_tool_id: "provider.company.lookup.fallback.v1",
      });
      assert.equal(requests.length, 3);
    },
  );
});

test("unknown settlement triggers one bounded usage and ledger reconciliation", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [{ tool_id: "provider.company.lookup.v1", params: [], expected_cost: 0 }],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({ message: "gateway timed out", execution_id: "exec-pending" }, 504);
      }
      if (request.url.pathname.endsWith("/auth/usage/history/v2")) {
        return response({ items: [{ execution_id: "exec-pending", charge_outcome: "pending" }], total: 1 });
      }
      if (request.url.pathname.endsWith("/auth/credits/ledger")) return response({ items: [], total: 0 });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.status, "unknown_settlement");
      assert.equal(result.execution_id, "exec-pending");
      assert.equal(result.settlement.usage_checked, true);
      assert.equal(result.settlement.ledger_checked, true);
      assert.equal(result.next_action.action, "wait_and_reconcile");
      assert.equal(process.exitCode, 1);
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search", "/api/v1/tools/execute", "/api/v1/auth/usage/history/v2", "/api/v1/auth/credits/ledger"],
      );
    },
  );
  process.exitCode = previousExitCode;
});

test("ordinary calls with an execution ID reconcile instead of recommending replay", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({ message: "gateway timed out", execution_id: "exec-direct" }, 504);
      }
      if (request.url.pathname.endsWith("/auth/usage/history/v2")) {
        assert.equal(request.url.searchParams.get("execution_id"), "exec-direct");
        return response({ items: [{ execution_id: "exec-direct", charge_outcome: "pending" }], total: 1 });
      }
      if (request.url.pathname.endsWith("/auth/credits/ledger")) return response({ items: [], total: 0 });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall("provider.company.lookup.v1", {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          discoveryId: "direct-search",
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.status, "unknown_settlement");
      assert.equal(result.execution_id, "exec-direct");
      assert.equal(result.context_handoff, undefined);
      assert.equal(result.next_action.action, "wait_and_reconcile");
      assert.equal(process.exitCode, 1);
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/tools/execute", "/api/v1/auth/usage/history/v2", "/api/v1/auth/credits/ledger"],
      );
    },
  );
  process.exitCode = previousExitCode;
});

for (const uncertainFailure of [
  {
    name: "timeout",
    errorCode: "NET_TIMEOUT",
    respond: () => Promise.reject(Object.assign(new Error(), { name: "AbortError" })),
  },
  { name: "rate limit", errorCode: "RATE_LIMITED", respond: () => response({ message: "retry later" }, 429) },
  { name: "request timeout", errorCode: "API_ERROR", respond: () => response({ message: "timed out" }, 408) },
  { name: "server error", errorCode: "API_ERROR", respond: () => response({ message: "gateway failed" }, 503) },
]) {
  test(`${uncertainFailure.name} without an execution ID forbids Call replay guidance`, async () => {
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/search")) {
          return response({
            search_id: "fresh-search",
            results: [
              {
                tool_id: "provider.company.lookup.v1",
                service_id: "service.market-data.v1",
                params: [],
                expected_cost: 0,
              },
              {
                tool_id: "provider.company.lookup.fallback.v1",
                service_id: "service.market-data.v1",
                params: [],
                expected_cost: 0,
              },
            ],
          });
        }
        if (request.url.pathname.endsWith("/tools/execute")) return uncertainFailure.respond();
        throw new Error(`Unexpected request: ${request.url.pathname}`);
      },
      async (requests) => {
        await assert.rejects(
          runCall(undefined, {
            apiKey: TEST_API_KEY,
            baseUrl: "https://unit.test/api/v1",
            context: liveContext(),
            json: true,
          }),
          (error) =>
            error instanceof CliError &&
            error.code === uncertainFailure.errorCode &&
            error.retryable === false &&
            error.action === "review_settlement" &&
            error.fallbackAvailable === false &&
            error.nextAction?.action === "review_settlement" &&
            error.nextAction?.requires_user === true &&
            error.nextAction?.reason === "execution_id_unavailable",
        );
        assert.deepEqual(
          requests.map((request) => request.url.pathname),
          ["/api/v1/search", "/api/v1/tools/execute"],
        );
      },
    );
  });
}

test("a rate-limit response with an execution ID is reconciled", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/tools/execute")) {
          return response({ message: "retry later", execution_id: "exec-rate-limited" }, 429);
        }
        if (request.url.pathname.endsWith("/auth/usage/history/v2")) {
          assert.equal(request.url.searchParams.get("execution_id"), "exec-rate-limited");
          return response({ items: [{ execution_id: "exec-rate-limited", charge_outcome: "pending" }], total: 1 });
        }
        if (request.url.pathname.endsWith("/auth/credits/ledger")) return response({ items: [], total: 0 });
        throw new Error(`Unexpected request: ${request.url.pathname}`);
      },
      async (requests) => {
        const output = await captureOutput(() =>
          runCall("provider.company.lookup.v1", {
            apiKey: TEST_API_KEY,
            baseUrl: "https://unit.test/api/v1",
            discoveryId: "direct-search",
            json: true,
          }),
        );
        const result = JSON.parse(output);
        assert.equal(result.status, "unknown_settlement");
        assert.equal(result.execution_id, "exec-rate-limited");
        assert.equal(result.next_action.action, "wait_and_reconcile");
        assert.notEqual(process.exitCode, 0);
        assert.deepEqual(
          requests.map((request) => request.url.pathname),
          ["/api/v1/tools/execute", "/api/v1/auth/usage/history/v2", "/api/v1/auth/credits/ledger"],
        );
      },
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});

for (const status of [400, 422]) {
  test(`Call HTTP ${status} requires parameter correction instead of retry`, async () => {
    await withMockFetch(
      (request) => {
        if (request.url.pathname.endsWith("/tools/execute")) return response({ message: "invalid parameters" }, status);
        throw new Error(`Unexpected request: ${request.url.pathname}`);
      },
      async (requests) => {
        await assert.rejects(
          runCall("provider.company.lookup.v1", {
            apiKey: TEST_API_KEY,
            baseUrl: "https://unit.test/api/v1",
            discoveryId: "direct-search",
            json: true,
          }),
          (error) =>
            error instanceof CliError &&
            error.code === "API_ERROR" &&
            error.status === status &&
            error.retryable === false &&
            error.action === "correct_parameters" &&
            error.fallbackAvailable === false &&
            error.nextAction?.action === "correct_parameters" &&
            error.nextAction?.requires_user === true &&
            error.nextAction?.reason === "invalid_call_request",
        );
        assert.equal(requests.filter((request) => request.url.pathname.endsWith("/tools/execute")).length, 1);
      },
    );
  });
}

for (const finalChargeOutcome of ["charged", "included", "failed_not_charged", "failed_charged_review"]) {
  test(`final ${finalChargeOutcome} settlement evidence stops the reconciliation loop`, async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withMockFetch(
        (request) => {
          if (request.url.pathname.endsWith("/tools/execute")) {
            return response({ message: "gateway timed out", execution_id: "exec-final" }, 504);
          }
          if (request.url.pathname.endsWith("/auth/usage/history/v2")) {
            return response({ items: [{ execution_id: "exec-final", charge_outcome: finalChargeOutcome }], total: 1 });
          }
          if (request.url.pathname.endsWith("/auth/credits/ledger")) return response({ items: [], total: 0 });
          throw new Error(`Unexpected request: ${request.url.pathname}`);
        },
        async () => {
          const output = await captureOutput(() =>
            runCall("provider.company.lookup.v1", {
              apiKey: TEST_API_KEY,
              baseUrl: "https://unit.test/api/v1",
              discoveryId: "direct-search",
              json: true,
            }),
          );
          const result = JSON.parse(output);
          assert.equal(result.status, "settlement_final");
          assert.equal(result.settlement.status, "final");
          assert.equal(result.next_action.action, "review_settlement");
          assert.equal(result.next_action.reason, "settlement_final");
          assert.equal(process.exitCode, 1);
        },
      );
    } finally {
      process.exitCode = previousExitCode;
    }
  });
}

test("context call fails closed on malformed discovery or probe responses", async () => {
  await withMockFetch(
    () => response({ results: [{ tool_id: "provider.company.lookup.v1" }] }),
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_REDISCOVERY_FAILED",
      );
    },
  );

  await withMockFetch(
    () => response({ search_id: "fresh-search", results: { tool_id: "provider.company.lookup.v1" } }),
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_REDISCOVERY_FAILED",
      );
    },
  );

  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({ search_id: "fresh-search", results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/by-ids"))
        return response({ results: { tool_id: "provider.company.lookup.v1" } });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_INSPECT_FAILED",
      );
    },
  );

  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [{ tool_id: "provider.company.lookup.v1" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({ results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/probe")) return response({});
      throw new Error("Call must not execute after a malformed probe response");
    },
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_PROBE_FAILED",
      );
    },
  );

  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [{ tool_id: "provider.company.lookup.v1" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({ results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/probe")) {
        return response({ schema: { valid: false, violations: { param: "symbol" } } });
      }
      throw new Error("Call must not execute after malformed probe violations");
    },
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) =>
          error instanceof CliError &&
          error.code === "CONTEXT_PROBE_FAILED" &&
          Array.isArray(error.missingFields) &&
          error.missingFields.length === 0,
      );
    },
  );
});

test("retryable context reads remain non-interactive", async () => {
  await withMockFetch(
    () => response({ results: [] }),
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) =>
          error instanceof CliError &&
          error.action === "rediscover" &&
          error.retryable === true &&
          error.nextAction?.requires_user === false,
      );
    },
  );

  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({ search_id: "fresh-search", results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) return response({ results: {} });
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) =>
          error instanceof CliError &&
          error.action === "inspect_again" &&
          error.retryable === true &&
          error.nextAction?.requires_user === false,
      );
    },
  );

  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({ search_id: "fresh-search", results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({ results: [{ tool_id: "provider.company.lookup.v1" }] });
      }
      if (request.url.pathname.endsWith("/tools/probe")) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) =>
          error instanceof CliError &&
          error.action === "probe_again" &&
          error.retryable === true &&
          error.nextAction?.requires_user === false,
      );
    },
  );
});

test("service-only context refreshes candidates without guessing or executing a tool", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [{ tool_id: "provider.current.v1" }],
        });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ tool_id: undefined }),
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.status, "candidates");
      assert.equal(result.execution_skipped, true);
      assert.deepEqual(
        result.candidates.map((candidate) => candidate.tool_id),
        ["provider.current.v1"],
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.query, "company-latest-filing service.market-data.v1");
    },
  );
});

test("service-only context broadens discovery when no candidate exists", async () => {
  await withMockFetch(
    () => response({ search_id: "fresh-search", results: [] }),
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ tool_id: undefined }),
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.status, "candidates");
      assert.deepEqual(result.candidates, []);
      assert.equal(result.context_handoff.action, "broaden_discovery");
      assert.deepEqual(result.next_action, {
        action: "broaden_discovery",
        automatic: false,
        requires_user: false,
        missing_fields: [],
        reason: "no_candidates",
      });
      assert.equal(requests.length, 1);
    },
  );
});
