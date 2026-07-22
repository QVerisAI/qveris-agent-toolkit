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
  await withMockFetch(
    (url, options) => {
      assert.equal(options.redirect, "error");
      requests.push({
        method: options.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: options.body ? JSON.parse(options.body) : undefined,
        authorization: options.headers.Authorization,
      });
      return jsonResponse({ ok: true, path: url.pathname });
    },
    async () => {
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
    },
  );

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

test("API client passes projections and retries once when a legacy service rejects optional fields", async () => {
  const discoverBodies = [];
  await withMockFetch(
    (_url, options) => {
      const body = JSON.parse(options.body);
      discoverBodies.push(body);
      if (discoverBodies.length === 1) {
        return jsonResponse(
          {
            detail: [
              { type: "extra_forbidden", loc: ["body", "view"] },
              { type: "extra_forbidden", loc: ["body", "lang"] },
            ],
          },
          { status: 422 },
        );
      }
      return jsonResponse({ search_id: "search-1", results: [] });
    },
    () =>
      discoverTools({
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        query: "weather",
        view: "routing",
        lang: "en",
      }),
  );
  assert.deepEqual(discoverBodies, [
    { query: "weather", limit: 5, view: "routing", lang: "en" },
    { query: "weather", limit: 5 },
  ]);

  const callBodies = [];
  await withMockFetch(
    (_url, options) => {
      const body = JSON.parse(options.body);
      callBodies.push(body);
      if (callBodies.length === 1) {
        return jsonResponse({ detail: [{ type: "extra_forbidden", loc: ["body", "respond_with"] }] }, { status: 422 });
      }
      return jsonResponse({ execution_id: "exec-1", success: true, result: { data: {} } });
    },
    () =>
      callTool({
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        toolId: "weather-tool",
        discoveryId: "search-1",
        parameters: {},
        respondWith: "summary",
      }),
  );
  assert.deepEqual(callBodies, [
    {
      search_id: "search-1",
      parameters: {},
      max_response_size: 102400,
      respond_with: "summary",
    },
    { search_id: "search-1", parameters: {}, max_response_size: 102400 },
  ]);
});

test("API client does not downgrade invalid projections", async () => {
  let requests = 0;
  await assert.rejects(
    withMockFetch(
      () => {
        requests += 1;
        return jsonResponse({ details: [{ type: "value_error", loc: ["body", "respond_with"] }] }, { status: 422 });
      },
      () =>
        callTool({
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          toolId: "weather-tool",
          parameters: {},
          respondWith: "fields:",
        }),
    ),
    (error) => error instanceof CliError && error.status === 422,
  );
  assert.equal(requests, 1);
});

test("API client gets async credentials for the configured resource", async () => {
  const contexts = [];
  const credentialProvider = {
    async getCredential(context) {
      contexts.push(context);
      return "short-lived-token";
    },
  };

  await withMockFetch(
    (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer short-lived-token");
      return jsonResponse({ ok: true });
    },
    () =>
      discoverTools({
        credentialProvider,
        baseUrl: "https://custom.example/api/v1/",
        query: "weather",
      }),
  );

  assert.deepEqual(contexts, [{ resource: "https://custom.example/api/v1", scopes: [] }]);
});

test("API request timeout starts after the credential resolves", async () => {
  const credentialProvider = {
    async getCredential() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "short-lived-token";
    },
  };

  await withMockFetch(
    (_url, options) => {
      assert.equal(options.signal.aborted, false);
      return jsonResponse({ ok: true });
    },
    () =>
      discoverTools({
        credentialProvider,
        query: "weather",
        timeoutMs: 1,
      }),
  );
});

test("OAuth credentials refresh once on 401 and business 403 is not retried", async () => {
  let credential = "expired-access";
  let refreshes = 0;
  const provider = {
    async getCredential() {
      return credential;
    },
    async refreshCredential() {
      refreshes += 1;
      credential = "fresh-access";
    },
  };
  let requests = 0;
  await withMockFetch(
    (_url, options) => {
      requests += 1;
      return options.headers.Authorization === "Bearer expired-access"
        ? jsonResponse({ message: "expired" }, { status: 401 })
        : jsonResponse({ ok: true });
    },
    () => discoverTools({ credentialProvider: provider, baseUrl: "https://unit.test/api/v1", query: "weather" }),
  );
  assert.equal(refreshes, 1);
  assert.equal(requests, 2);

  requests = 0;
  await assert.rejects(
    withMockFetch(
      () => {
        requests += 1;
        return jsonResponse({ message: "forbidden" }, { status: 403 });
      },
      () => discoverTools({ credentialProvider: provider, baseUrl: "https://unit.test/api/v1", query: "weather" }),
    ),
    /forbidden/,
  );
  assert.equal(requests, 1);
  assert.equal(refreshes, 1);

  const oauthProvider = {
    authType: "oauth",
    async getCredential() {
      return "oauth-access";
    },
    async refreshCredential() {},
  };
  await assert.rejects(
    withMockFetch(
      () => jsonResponse({ message: "session expired" }, { status: 401 }),
      () => discoverTools({ credentialProvider: oauthProvider, baseUrl: "https://unit.test/api/v1", query: "weather" }),
    ),
    (error) => error instanceof CliError && error.code === "AUTH_OAUTH_FAILED" && /session expired/.test(error.message),
  );

  await assert.rejects(
    withMockFetch(
      () => jsonResponse({ message: "missing required scope" }, { status: 403 }),
      () => discoverTools({ credentialProvider: oauthProvider, baseUrl: "https://unit.test/api/v1", query: "weather" }),
    ),
    (error) => error instanceof CliError && error.code === "API_ERROR" && /missing required scope/.test(error.message),
  );
});

test("API client rejects ambiguous or invalid provider credentials without exposing values", async () => {
  await assert.rejects(
    discoverTools({
      apiKey: "sk-test",
      credentialProvider: { getCredential: async () => "short-lived-token" },
      query: "weather",
    }),
    /either apiKey or credentialProvider/,
  );

  const secret = "secret-token";
  await assert.rejects(
    discoverTools({
      credentialProvider: { getCredential: async () => `${secret}\nforged-header` },
      query: "weather",
    }),
    (err) => err instanceof CliError && /invalid credential/.test(err.message) && !err.message.includes(secret),
  );

  await assert.rejects(
    discoverTools({
      credentialProvider: {
        async getCredential() {
          throw new Error(`failed while handling ${secret}`);
        },
      },
      query: "weather",
    }),
    (err) =>
      err instanceof CliError && /failed to provide a credential/.test(err.message) && !err.message.includes(secret),
  );
});

test("API client preserves actionable CLI errors from credential providers", async () => {
  const providerError = new CliError("API_ERROR", "Rotated OAuth credentials could not be persisted");
  await assert.rejects(
    discoverTools({
      credentialProvider: {
        async getCredential() {
          throw providerError;
        },
      },
      baseUrl: "https://unit.test/api/v1",
      query: "weather",
    }),
    (error) => error === providerError,
  );
});

test("QVERIS_BASE_URL controls every API call and normalizes trailing slashes", async () => {
  const previous = process.env.QVERIS_BASE_URL;
  const paths = [];
  try {
    for (const baseUrl of ["https://api.qveris.cloud/api/v1/", "https://test.qveris.cn/api/v1///"]) {
      process.env.QVERIS_BASE_URL = baseUrl;
      await withMockFetch(
        (url) => {
          paths.push(url.toString());
          return jsonResponse({ ok: true });
        },
        async () => {
          await discoverTools({ apiKey: "sk-test", query: "weather" });
          await inspectToolsByIds({ apiKey: "sk-test", toolIds: ["tool-1"] });
          await callTool({ apiKey: "sk-test", toolId: "tool-1", parameters: {} });
          await getCredits({ apiKey: "sk-test" });
          await getUsageHistory({ apiKey: "sk-test" });
          await getCreditsLedger({ apiKey: "sk-test" });
        },
      );
    }
  } finally {
    if (previous === undefined) delete process.env.QVERIS_BASE_URL;
    else process.env.QVERIS_BASE_URL = previous;
  }

  assert.equal(paths.length, 12);
  assert.equal(
    paths.slice(0, 6).every((url) => url.startsWith("https://api.qveris.cloud/api/v1/")),
    true,
  );
  assert.equal(
    paths.slice(6).every((url) => url.startsWith("https://test.qveris.cn/api/v1/")),
    true,
  );
});

test("API client converts HTTP failures into CLI errors", async () => {
  await withMockFetch(
    () => jsonResponse({ message: "bad key" }, { status: 401 }),
    async () => {
      await assert.rejects(
        discoverTools({ apiKey: "sk-test", baseUrl: "https://unit.test/api/v1", query: "x" }),
        (err) =>
          err instanceof CliError &&
          err.code === "AUTH_INVALID_KEY" &&
          err.hint === "Check your key at https://unit.test/account",
      );
    },
  );

  await withMockFetch(
    () => jsonResponse({ message: "not enough credits" }, { status: 402 }),
    async () => {
      await assert.rejects(
        callTool({
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          toolId: "tool-1",
          discoveryId: "search-1",
          parameters: {},
        }),
        (err) =>
          err instanceof CliError &&
          err.code === "CREDITS_INSUFFICIENT" &&
          err.hint === "Purchase credits at https://unit.test/pricing",
      );
    },
  );
});

test("unwrapApiResponse accepts raw payloads and unwraps success envelopes", () => {
  assert.deepEqual(unwrapApiResponse({ items: [1] }), { items: [1] });
  assert.deepEqual(unwrapApiResponse({ status: "success", data: { items: [2] } }), { items: [2] });
  assert.throws(
    () => unwrapApiResponse({ status: "failure", message: "boom", data: null }),
    (err) => err instanceof CliError && err.code === "API_ERROR",
  );
});
