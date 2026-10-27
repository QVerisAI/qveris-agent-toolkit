import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverTools, inspectToolsByIds, callTool } from "../src/client/api.mjs";
import { runDiscover } from "../src/commands/discover.mjs";
import { runInspect } from "../src/commands/inspect.mjs";
import { runCall } from "../src/commands/call.mjs";
import { main } from "../src/main.mjs";
import { readSession } from "../src/session/session.mjs";
import { writeConfig } from "../src/config/store.mjs";
import { getOAuthSessionMetadata } from "../src/auth/storage.mjs";

const publicId = "pub_11111111-1111-4111-8111-111111111111";
const tool = { tool_id: "tool-a", name: "Synthetic tool", idempotent: true, dangerous_side_effects: false };
const baseUrl = "https://unit.test/api/v1";
const flags = { baseUrl, publicReadOnly: true, json: true };
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const publicResult = () => ({ search_id: publicId, results: [tool], contract_features: ["public-readonly-v1"] });

async function fixture(fn) {
  const directory = mkdtempSync(join(tmpdir(), "qveris-public-discovery-"));
  const before = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    QVERIS_API_KEY: process.env.QVERIS_API_KEY,
    QVERIS_BASE_URL: process.env.QVERIS_BASE_URL,
  };
  const fetch = globalThis.fetch,
    log = console.log,
    exit = process.exitCode;
  process.env.XDG_CONFIG_HOME = directory;
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  getOAuthSessionMetadata({ fresh: true });
  const requests = [];
  const output = [];
  console.log = (...values) => output.push(values.join(" "));
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, options, body: JSON.parse(options.body) });
    return response(publicResult());
  };
  try {
    await fn(requests, output);
  } finally {
    globalThis.fetch = fetch;
    console.log = log;
    process.exitCode = exit;
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    getOAuthSessionMetadata({ fresh: true });
    rmSync(directory, { recursive: true, force: true });
  }
}

test("explicit CLI Discover/Inspect use S5 without bearer, cookies, fallback, or account creation", async () =>
  fixture(async (requests) => {
    await main(["node", "qveris", "discover", "weather", "--public-read-only", "--base-url", baseUrl, "--json"]);
    await runInspect(["1"], flags);
    assert.deepEqual(
      requests.map((request) => request.path),
      ["/api/v1/search", "/api/v1/tools/by-ids"],
    );
    for (const { options } of requests) {
      assert.equal(options.headers["X-Qveris-Access-Mode"], "public-readonly");
      assert.equal(new Headers(options.headers).has("authorization"), false);
      assert.equal(new Headers(options.headers).has("cookie"), false);
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
    }
    assert.equal(requests[1].body.search_id, publicId);
    assert.equal(readSession().authorizationContext, "v1:public-discovery");
  }));

test("public mode rejects configured keys and OAuth before HTTP while default missing-auth still fails", async () =>
  fixture(async (requests) => {
    await assert.rejects(runDiscover("weather", { baseUrl, json: true }), (error) => error.code === "AUTH_MISSING_KEY");
    for (const key of ["valid-synthetic", "bad-synthetic", "", "YOUR_API_KEY"]) {
      await assert.rejects(
        runDiscover("weather", { ...flags, apiKey: key }),
        (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT",
      );
    }
    // Generate a disposable fixture value; no credential is embedded in source.
    process.env.QVERIS_API_KEY = randomUUID();
    await assert.rejects(runDiscover("weather", flags), (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT");
    delete process.env.QVERIS_API_KEY;
    writeConfig({ api_key: randomUUID() });
    await assert.rejects(runDiscover("weather", flags), (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT");
    writeConfig({ oauth_session: { issuer: "https://unit.test", expires_at: 1, storage: "session" } });
    getOAuthSessionMetadata({ fresh: true });
    await assert.rejects(runDiscover("weather", flags), (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT");
    assert.equal(requests.length, 0);
  }));

test("public flag cannot run Probe, Call, audit, or model commands", async () =>
  fixture(async (requests) => {
    for (const command of ["probe", "call", "credits", "ledger", "history", "models", "auth"]) {
      await main(["node", "qveris", command, "tool-a", "--public-read-only", "--json"]);
      assert.equal(process.exitCode, 77);
    }
    assert.equal(requests.length, 0);
  }));

test("public inputs are bounded and unsupported fields are never retried away", async () =>
  fixture(async (requests) => {
    for (const change of [
      { query: " " },
      { query: "x".repeat(1025) },
      { limit: 21 },
      { lang: "en" },
      { view: "private" },
    ]) {
      await assert.rejects(discoverTools({ baseUrl, publicReadOnly: true, query: "weather", ...change }));
    }
    for (const ids of [[], ["a", "a"], Array.from({ length: 11 }, (_, index) => String(index)), ["x".repeat(256)]]) {
      await assert.rejects(inspectToolsByIds({ baseUrl, publicReadOnly: true, toolIds: ids }));
    }
    await assert.rejects(
      inspectToolsByIds({ baseUrl, publicReadOnly: true, toolIds: ["a"], discoveryId: "private-search" }),
    );
    await assert.rejects(
      inspectToolsByIds({
        baseUrl,
        publicReadOnly: true,
        toolIds: Array.from({ length: 10 }, (_, i) => `${i}${"😀".repeat(250)}`),
      }),
    );
    assert.equal(requests.length, 0);
  }));

test("malformed public contracts and authentication failures do not become discovery sessions", async () =>
  fixture(async () => {
    for (const body of [
      { search_id: "private", results: [] },
      { ...publicResult(), remaining_credits: 1 },
    ]) {
      globalThis.fetch = async () => response(body);
      await assert.rejects(runDiscover("weather", flags), /public-readonly-v1/);
      assert.equal(readSession(), null);
    }
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return response({ message: "Authentication required" }, 401);
    };
    await assert.rejects(
      discoverTools({ baseUrl, publicReadOnly: true, query: "weather" }),
      (error) => error.code === "PUBLIC_DISCOVERY_UNAVAILABLE",
    );
    await assert.rejects(
      discoverTools({ baseUrl, apiKey: "bad-synthetic", query: "weather" }),
      (error) => error.code === "AUTH_INVALID_KEY",
    );
    assert.equal(calls, 2);
  }));

test("login refreshes a public selection by authenticated Inspect, then validates current input/quote before explicit Call", async () =>
  fixture(async () => {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(options.body);
      requests.push({ path, body, headers: options.headers });
      if (path.endsWith("/search")) return response(publicResult());
      if (path.endsWith("/tools/by-ids")) {
        assert.notEqual(body.search_id, publicId);
        return response({ search_id: "authenticated-search", results: [tool] });
      }
      if (path.endsWith("/tools/probe")) {
        assert.deepEqual(body.parameters, { city: "London" });
        return response({
          executable: true,
          schema: { valid: true },
          quote: { currency: "credits", exact: true, estimate_credits: 1 },
        });
      }
      if (path.endsWith("/tools/execute")) return response({ execution_id: "synthetic-execution", success: true });
      throw new Error("Unexpected request");
    };
    await runDiscover("weather", flags);
    const fixtureKey = randomUUID();
    process.env.QVERIS_API_KEY = fixtureKey;
    const authenticated = { baseUrl, json: true, params: '{"city":"London"}' };
    await assert.rejects(runCall("1", authenticated), (error) => error.code === "AUTH_PUBLIC_CONTEXT");
    assert.equal(requests.length, 1);
    await runInspect(["1"], authenticated);
    assert.equal(readSession().upgradedFromPublic, true);
    await runCall("1", authenticated);
    assert.deepEqual(
      requests.map(({ path }) => path),
      [
        "/api/v1/search",
        "/api/v1/tools/by-ids",
        "/api/v1/tools/by-ids",
        "/api/v1/tools/probe",
        "/api/v1/tools/execute",
      ],
    );
    assert.equal(requests.at(-1).body.search_id, "authenticated-search");
    assert.deepEqual(requests.at(-1).body.parameters, { city: "London" });
    for (const { headers } of requests.slice(1)) assert.equal(headers.Authorization, `Bearer ${fixtureKey}`);
    await assert.rejects(
      callTool({ apiKey: fixtureKey, baseUrl, toolId: "a", discoveryId: publicId, parameters: {} }),
      (error) => error.code === "AUTH_PUBLIC_CONTEXT",
    );
  }));
