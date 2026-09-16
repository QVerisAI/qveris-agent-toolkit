import assert from "node:assert/strict";
import test from "node:test";

import { runCall } from "../src/commands/call.mjs";
import { CliError } from "../src/errors/handler.mjs";
import { outputJsonError } from "../src/output/json.mjs";
import { assertInstallContextCurrent, parseInstallContext } from "../src/utils/install-context.mjs";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

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

function currentPipeline(request, executePayload = { execution_id: "exec-1", success: true, result: { data: {} } }) {
  if (request.url.pathname.endsWith("/search")) {
    return response({
      search_id: "fresh-search",
      results: [{ tool_id: "provider.company.lookup.v1" }],
    });
  }
  if (request.url.pathname.endsWith("/tools/by-ids")) {
    return response({
      results: [{ tool_id: "provider.company.lookup.v1" }],
    });
  }
  if (request.url.pathname.endsWith("/tools/probe")) {
    return response({ schema: { valid: true }, quote: { estimate_credits: 2 } });
  }
  if (request.url.pathname.endsWith("/tools/execute")) return response(executePayload);
  throw new Error(`Unexpected request: ${request.url.pathname}`);
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
  const unsafe = [
    context({ prompt: "private-customer-request" }),
    context({ service_id: "service:sk-abcdefghijklmnopqrstuv" }),
    context({ task_id: "123-45-6789" }),
    context({ task_id: "operator@example.com" }),
    context({ task_id: "13800138000" }),
    context({ task_id: "11010519491231002X" }),
    context({ task_id: "4111111111111111" }),
    context({ task_id: "GB82WEST12345698765432" }),
    context({ extensions: { "example.data": { api_key: "not-echoed" } } }),
    context({ extensions: { "example.data": JSON.parse('{"__proto__":{"polluted":true}}') } }),
  ];
  for (const raw of unsafe) {
    assert.throws(
      () => parseInstallContext(raw, NOW_MS),
      (error) => error instanceof CliError && error.code === "CONTEXT_UNSAFE",
    );
  }

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
});

test("context call executes after Discover when its schema is sufficient", async () => {
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
        return response({ execution_id: "exec-1", success: true, result: { data: {} } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
      );
      assert.equal(JSON.parse(output).execution_id, "exec-1");
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search", "/api/v1/tools/execute"],
      );
      assert.deepEqual(requests[0].body, {
        query: "company-latest-filing service.market-data.v1 provider.company.lookup.v1",
        limit: 100,
      });
      assert.equal(requests[1].body.search_id, "fresh-search");
      assert.deepEqual(JSON.parse(output).context_handoff.validation_steps, ["discover"]);
    },
  );
});

test("context call preserves permission and insufficient-credit failures", async () => {
  await withMockFetch(
    () => response({ message: "missing required scope" }, 403),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "PERMISSION_DENIED",
      );
      assert.equal(requests.length, 1);
    },
  );

  await withMockFetch(
    (request) =>
      request.url.pathname.endsWith("/tools/execute")
        ? response({ message: "not enough credits" }, 402)
        : currentPipeline(request),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CREDITS_INSUFFICIENT",
      );
      assert.equal(requests.length, 4);
    },
  );
});

test("context call reports upstream failure and unknown settlement without claiming a charge", async () => {
  const upstreamFailure = {
    execution_id: "exec-failed",
    success: false,
    error_message: "upstream provider unavailable",
  };
  await withMockFetch(
    (request) => currentPipeline(request, upstreamFailure),
    async () => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
      );
      assert.match(output, /upstream provider unavailable/);
      assert.match(output, /Final charge status: qveris usage --mode search --execution-id exec-failed/);
      assert.doesNotMatch(output, /credits (?:charged|included)|settlement complete/i);
    },
  );
});

test("context call stops when fresh discovery no longer contains the copied tool", async () => {
  await withMockFetch(
    () => response({ search_id: "fresh-search", results: [] }),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
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

test("expired context automatically refreshes and unknown price does not force Probe", async () => {
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
        return response({ execution_id: "exec-refreshed", success: true, result: { data: {} } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async (requests) => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ context_issued_at: now - 120, context_expires_at: now - 1 }),
          params: '{"symbol":"AAPL"}',
          json: true,
        }),
      );
      const result = JSON.parse(output);
      assert.equal(result.execution_id, "exec-refreshed");
      assert.equal(result.context_handoff.stale_input, true);
      assert.deepEqual(result.context_handoff.validation_steps, ["discover"]);
      assert.ok(result.context_handoff.warnings.some((warning) => warning.code === "PRICE_UNKNOWN"));
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        ["/api/v1/search", "/api/v1/tools/execute"],
      );
    },
  );
});

test("quote is a gate only when budget policy requires it", async () => {
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
          apiKey: "sk-test",
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

test("paid risk obtains a quote and enforces the user budget", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [
            {
              tool_id: "provider.company.lookup.v1",
              params: [{ name: "symbol", type: "string", required: true, description: "ticker" }],
              expected_cost: 2,
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/probe")) {
        return response({ quote: { estimate_credits: 3, currency: "credits", exact: true } });
      }
      throw new Error("Call must not execute above the user budget");
    },
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
          params: '{"symbol":"AAPL"}',
          maxCredits: "2",
          json: true,
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_BUDGET_EXCEEDED",
      );
      assert.deepEqual(requests[1].body.checks, ["quote"]);
      assert.equal(requests.length, 2);
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
          apiKey: "sk-test",
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

test("dangerous execution fails closed before Call", async () => {
  await withMockFetch(
    () =>
      response({
        search_id: "fresh-search",
        results: [
          {
            tool_id: "provider.company.lookup.v1",
            params: [],
            expected_cost: 0,
            dangerous_side_effects: true,
          },
        ],
      }),
    async (requests) => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
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

test("context call fails closed on malformed discovery or probe responses", async () => {
  await withMockFetch(
    () => response({ results: [{ tool_id: "provider.company.lookup.v1" }] }),
    async () => {
      await assert.rejects(
        runCall(undefined, {
          apiKey: "sk-test",
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
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext(),
        }),
        (error) => error instanceof CliError && error.code === "CONTEXT_PROBE_FAILED",
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
          apiKey: "sk-test",
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
    },
  );
});
