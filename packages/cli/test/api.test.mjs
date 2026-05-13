import assert from "node:assert/strict";
import test from "node:test";

import {
  callTool,
  discoverTools,
  getCredits,
  getCreditsLedger,
  getUsageHistory,
  inspectToolsByIds,
  unwrapApiResponse,
} from "../src/client/api.mjs";
import { CliError } from "../src/errors/handler.mjs";

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(new URL(url), options);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("API client maps discover, inspect, call, credits, usage, and ledger endpoints", async () => {
  const requests = [];
  await withMockFetch((url, options) => {
    requests.push({
      method: options.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: options.body ? JSON.parse(options.body) : undefined,
      authorization: options.headers.Authorization,
    });
    return jsonResponse({ ok: true, path: url.pathname });
  }, async () => {
    await discoverTools({
      apiKey: "sk-test",
      baseUrl: "https://unit.test/api/v1",
      query: "weather",
      limit: 2,
      timeoutMs: 1000,
    });
    await inspectToolsByIds({
      apiKey: "sk-test",
      baseUrl: "https://unit.test/api/v1",
      toolIds: ["tool-1"],
      discoveryId: "search-1",
      timeoutMs: 1000,
    });
    await callTool({
      apiKey: "sk-test",
      baseUrl: "https://unit.test/api/v1",
      toolId: "tool-1",
      discoveryId: "search-1",
      parameters: { city: "London" },
      maxResponseSize: 123,
      timeoutMs: 1000,
    });
    await getCredits({ apiKey: "sk-test", baseUrl: "https://unit.test/api/v1", timeoutMs: 1000 });
    await getUsageHistory({
      apiKey: "sk-test",
      baseUrl: "https://unit.test/api/v1",
      query: { execution_id: "exec-1", summary: true },
      timeoutMs: 1000,
    });
    await getCreditsLedger({
      apiKey: "sk-test",
      baseUrl: "https://unit.test/api/v1",
      query: { direction: "consume", min_credits: 5 },
      timeoutMs: 1000,
    });
  });

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/api/v1/search",
      query: {},
      body: { query: "weather", limit: 2 },
      authorization: "Bearer sk-test",
    },
    {
      method: "POST",
      path: "/api/v1/tools/by-ids",
      query: {},
      body: { tool_ids: ["tool-1"], search_id: "search-1" },
      authorization: "Bearer sk-test",
    },
    {
      method: "POST",
      path: "/api/v1/tools/execute",
      query: { tool_id: "tool-1" },
      body: { search_id: "search-1", parameters: { city: "London" }, max_response_size: 123 },
      authorization: "Bearer sk-test",
    },
    {
      method: "GET",
      path: "/api/v1/auth/credits",
      query: {},
      body: undefined,
      authorization: "Bearer sk-test",
    },
    {
      method: "GET",
      path: "/api/v1/auth/usage/history/v2",
      query: { execution_id: "exec-1", summary: "true" },
      body: undefined,
      authorization: "Bearer sk-test",
    },
    {
      method: "GET",
      path: "/api/v1/auth/credits/ledger",
      query: { direction: "consume", min_credits: "5" },
      body: undefined,
      authorization: "Bearer sk-test",
    },
  ]);
});

test("API client converts HTTP failures into CLI errors", async () => {
  await withMockFetch(() => jsonResponse({ message: "bad key" }, { status: 401 }), async () => {
    await assert.rejects(
      discoverTools({ apiKey: "sk-test", baseUrl: "https://unit.test/api/v1", query: "x" }),
      (err) => err instanceof CliError && err.code === "AUTH_INVALID_KEY"
    );
  });

  await withMockFetch(() => jsonResponse({ message: "not enough credits" }, { status: 402 }), async () => {
    await assert.rejects(
      callTool({
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        toolId: "tool-1",
        discoveryId: "search-1",
        parameters: {},
      }),
      (err) => err instanceof CliError && err.code === "CREDITS_INSUFFICIENT" && err.hint.includes("/pricing")
    );
  });
});

test("unwrapApiResponse accepts raw payloads and unwraps success envelopes", () => {
  assert.deepEqual(unwrapApiResponse({ items: [1] }), { items: [1] });
  assert.deepEqual(unwrapApiResponse({ status: "success", data: { items: [2] } }), { items: [2] });
  assert.throws(
    () => unwrapApiResponse({ status: "failure", message: "boom", data: null }),
    (err) => err instanceof CliError && err.code === "API_ERROR"
  );
});
