import assert from "node:assert/strict";
import test from "node:test";

import { discoverTools } from "../src/client/api.mjs";
import { CliError } from "../src/errors/handler.mjs";
import {
  computeRetryDelayMs,
  DEFAULT_MAX_RETRIES,
  parseRetryAfterMs,
  resolveMaxRetries,
} from "../src/client/retry.mjs";

// --- pure helpers ------------------------------------------------------------

test("parseRetryAfterMs handles seconds, HTTP-date, and junk", () => {
  assert.equal(parseRetryAfterMs("12"), 12_000);
  assert.equal(parseRetryAfterMs("0"), 0);

  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 2020 00:00:00 GMT", now), 0);

  for (const junk of [null, undefined, "", "not-a-date", "-5", "12.5", "²"]) {
    assert.equal(parseRetryAfterMs(junk), null, `${junk} -> null`);
  }
});

test("computeRetryDelayMs honors Retry-After, backs off with jitter, caps, no overflow", () => {
  const base = { baseDelayMs: 500, maxDelayMs: 60_000 };
  assert.equal(computeRetryDelayMs({ ...base, retryAfterMs: 2_000, attempt: 0 }), 2_000);
  assert.equal(computeRetryDelayMs({ ...base, retryAfterMs: 999_999, attempt: 0 }), 60_000);

  const full = (attempt) => computeRetryDelayMs({ ...base, retryAfterMs: null, attempt, random: () => 1 });
  assert.equal(full(0), 500);
  assert.equal(full(1), 1_000);
  assert.equal(full(2), 2_000);
  assert.equal(computeRetryDelayMs({ ...base, retryAfterMs: null, attempt: 0, random: () => 0 }), 250);
  assert.equal(full(5000), 60_000); // no overflow at a huge attempt
});

test("resolveMaxRetries defaults, clamps, and floors", () => {
  assert.equal(resolveMaxRetries(undefined), DEFAULT_MAX_RETRIES);
  assert.equal(resolveMaxRetries("5"), 5);
  assert.equal(resolveMaxRetries("0"), 0);
  assert.equal(resolveMaxRetries("-3"), 0);
  assert.equal(resolveMaxRetries("2.9"), 2);
  assert.equal(resolveMaxRetries("nope"), DEFAULT_MAX_RETRIES);
});

// --- integration through discoverTools --------------------------------------

function rateLimited() {
  return new Response(JSON.stringify({ error_message: "rate limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "0" }, // 0 -> instant retry
  });
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(new URL(url), options);
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  }
}

const DISCOVER_ARGS = { apiKey: "sk-test", baseUrl: "https://unit.test/api/v1", query: "weather", timeoutMs: 1000 };

test("retries a 429 then succeeds", async () => {
  let calls = 0;
  await withMockFetch(
    () => {
      calls += 1;
      return calls === 1 ? rateLimited() : jsonResponse({ search_id: "s1", results: [] });
    },
    async () => {
      const result = await discoverTools(DISCOVER_ARGS);
      assert.equal(result.search_id, "s1");
      assert.equal(calls, 2);
    },
  );
});

test("gives up after maxRetries and throws RATE_LIMITED", async () => {
  let calls = 0;
  await withEnv("QVERIS_MAX_RETRIES", "2", () =>
    withMockFetch(
      () => {
        calls += 1;
        return rateLimited();
      },
      async () => {
        const err = await discoverTools(DISCOVER_ARGS).catch((e) => e);
        assert.ok(err instanceof CliError);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(calls, 3); // maxRetries + 1
      },
    ),
  );
});

test("QVERIS_MAX_RETRIES=0 disables retrying", async () => {
  let calls = 0;
  await withEnv("QVERIS_MAX_RETRIES", "0", () =>
    withMockFetch(
      () => {
        calls += 1;
        return rateLimited();
      },
      async () => {
        const err = await discoverTools(DISCOVER_ARGS).catch((e) => e);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(calls, 1);
      },
    ),
  );
});
