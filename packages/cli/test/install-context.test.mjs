import assert from "node:assert/strict";
import test from "node:test";

import { runCall } from "../src/commands/call.mjs";
import { CliError } from "../src/errors/handler.mjs";
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

function currentPipeline(request, executePayload = { execution_id: "exec-1", success: true, result: { data: {} } }) {
  if (request.url.pathname.endsWith("/search")) {
    return response({
      search_id: "fresh-search",
      results: [{ tool_id: "provider.company.lookup.v1", service_id: "service.market-data.v1" }],
    });
  }
  if (request.url.pathname.endsWith("/tools/by-ids")) {
    return response({
      results: [{ tool_id: "provider.company.lookup.v1", service_id: "service.market-data.v1" }],
    });
  }
  if (request.url.pathname.endsWith("/tools/probe")) {
    return response({ schema: { valid: true }, quote: { estimate_credits: 2 } });
  }
  if (request.url.pathname.endsWith("/tools/execute")) return response(executePayload);
  throw new Error(`Unexpected request: ${request.url.pathname}`);
}

test("v1 parser accepts only current public-ID templates", () => {
  assert.deepEqual(parseInstallContext(context(), NOW_MS), {
    version: 1,
    issuedAt: NOW_SECONDS - 60,
    expiresAt: NOW_SECONDS + 600,
    taskId: "company-latest-filing",
    serviceId: "service.market-data.v1",
    toolId: "provider.company.lookup.v1",
    templateId: "filing-summary.v1",
  });
  assert.equal(
    parseInstallContext(context({ task_id: "0123456789abcdef0123456789abcdef" }), NOW_MS).taskId,
    "0123456789abcdef0123456789abcdef",
  );
});

test("v1 parser rejects expired, future-issued, past-version, and future-version contexts", () => {
  assert.throws(
    () => parseInstallContext(context({ context_expires_at: NOW_SECONDS }), NOW_MS),
    (error) => error instanceof CliError && error.code === "CONTEXT_EXPIRED",
  );
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
});

test("context lifetime can be rechecked immediately before execution", () => {
  const parsed = parseInstallContext(context(), NOW_MS);
  assert.throws(
    () => assertInstallContextCurrent(parsed, (NOW_SECONDS + 600) * 1000),
    (error) => error instanceof CliError && error.code === "CONTEXT_EXPIRED",
  );
});

test("v1 parser rejects unknown, duplicate, credential, PII, and payload fields without echoing values", () => {
  const unsafe = [
    context({ prompt: "private-customer-request" }),
    context({ service_id: "service:sk-abcdefghijklmnopqrstuv" }),
    context({ task_id: "123-45-6789" }),
    context({ task_id: "operator@example.com" }),
    context({ task_id: "13800138000" }),
    context({ task_id: "11010519491231002X" }),
    context({ task_id: "4111111111111111" }),
    context({ task_id: "GB82WEST12345698765432" }),
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

test("context call re-discovers, inspects, probes, and executes with only the fresh search ID", async () => {
  await withMockFetch(
    (request) => currentPipeline(request),
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
        ["/api/v1/search", "/api/v1/tools/by-ids", "/api/v1/tools/probe", "/api/v1/tools/execute"],
      );
      assert.deepEqual(requests[0].body, {
        query: "company-latest-filing service.market-data.v1 provider.company.lookup.v1",
        limit: 100,
      });
      assert.deepEqual(requests[1].body, {
        tool_ids: ["provider.company.lookup.v1"],
        search_id: "fresh-search",
      });
      assert.deepEqual(requests[2].body, {
        parameters: { symbol: "AAPL" },
        checks: ["schema", "quote"],
        live_budget: "none",
      });
      assert.equal(requests[3].body.search_id, "fresh-search");
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
          results: [{ tool_id: "provider.company.lookup.v1", service_id: "service.market-data.v1" }],
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

test("service-only context requires exactly one current matching service tool", async () => {
  await withMockFetch(
    (request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "fresh-search",
          results: [{ tool_id: "provider.current.v1", service_id: "service.market-data.v1" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({
          results: [{ tool_id: "provider.current.v1", service_id: "service.market-data.v1" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/probe")) return response({ schema: { valid: true } });
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({ execution_id: "exec-service", success: true, result: { data: {} } });
      }
      throw new Error(`Unexpected request: ${request.url.pathname}`);
    },
    async () => {
      const output = await captureOutput(() =>
        runCall(undefined, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          context: liveContext({ tool_id: undefined }),
          json: true,
        }),
      );
      assert.equal(JSON.parse(output).execution_id, "exec-service");
    },
  );
});
