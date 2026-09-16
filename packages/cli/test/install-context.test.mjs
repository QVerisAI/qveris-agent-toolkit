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
    "token sk-abcdefghijklmnopqrstuv",
    "token ghp_abcdefghijklmnopqrst",
    "token xoxb-abcdefghijklmnop",
    "token AKIAABCDEFGHIJKLMNOP",
    "token AIzaabcdefghijklmnopqrst",
    "token Bearer abcdefghijklmnopqrstuvwxyz",
    "token eyJabc.def.ghi",
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
    context({ future_display_hint: "prefix: Bearer abcdefghijklmnopqrstuvwxyz; suffix" }),
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

test("context call fails closed when the public contract lacks execution-safety metadata", async () => {
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
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_EXECUTION_SAFETY_UNVERIFIED",
      );
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search"],
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

test("context call stops when fresh discovery no longer contains the copied tool", async () => {
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
      assert.equal(requests.length, 1);
    },
  );
});

test("expired context refreshes and checks unknown price without probing before safety rejection", async () => {
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
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ context_issued_at: now - 120, context_expires_at: now - 1 }),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_EXECUTION_SAFETY_UNVERIFIED",
      );
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search"],
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

test("integer parameters use JSON integer semantics before safety rejection", async () => {
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
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"count":2}',
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_EXECUTION_SAFETY_UNVERIFIED",
      );
      assert.equal(requests.length, 1);
    },
  );
});

test("missing exact tool exposes safe provider fallback candidates without executing", async () => {
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
      assert.equal(requests.length, 1);
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
    missing_fields: [],
    fallback_available: true,
    candidates: [{ tool_id: "provider.fallback.v1", provider_id: "fallback" }],
    exit_code: 69,
  });
});

test("execution-safety metadata cannot be bypassed with confirmation flags", async () => {
  await withMockFetch(
    () =>
      response({
        search_id: "fresh-search",
        results: [
          {
            tool_id: "provider.company.lookup.v1",
            params: [],
            expected_cost: 0,
          },
        ],
      }),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: TEST_API_KEY,
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          allowSideEffects: true,
          allowNonIdempotent: true,
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_EXECUTION_SAFETY_UNVERIFIED",
      );
      assert.equal(requests.length, 1);
    },
  );
});

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
