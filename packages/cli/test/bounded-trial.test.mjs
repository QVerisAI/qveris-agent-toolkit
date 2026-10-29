import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/main.mjs";
import { readConfig, writeConfig } from "../src/config/store.mjs";
import { getTrialRegistration } from "../src/auth/trial-storage.mjs";

const base = "https://bounded.example.test/api/v1";
const key = randomUUID();
const agentId = randomUUID();
const view = (state) => ({
  state,
  expiresAt: "2099-12-31T00:00:00Z",
  trialCredits: "17.250",
  balanceCredits: "17.250",
});
const response = (data, status = 200) =>
  new Response(JSON.stringify({ status: "success", status_code: 0, data }), { status });
async function isolated(fn) {
  const directory = mkdtempSync(join(tmpdir(), "bounded-cli-"));
  const names = ["XDG_CONFIG_HOME", "QVERIS_API_KEY", "QVERIS_BASE_URL", "QVERIS_DISABLE_KEYRING", "NO_COLOR"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalExit = process.exitCode;
  process.env.XDG_CONFIG_HOME = directory;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  process.env.NO_COLOR = "1";
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    process.exitCode = originalExit;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
async function cli(...args) {
  let output = "";
  const stdout = process.stdout.write,
    stderr = process.stderr.write;
  process.stdout.write = (chunk) => {
    if (typeof chunk !== "string") return stdout.call(process.stdout, chunk);
    output += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    if (typeof chunk !== "string") return stderr.call(process.stderr, chunk);
    output += chunk;
    return true;
  };
  process.exitCode = 0;
  try {
    await main(["node", "qveris", ...args]);
    return { output, exit: process.exitCode };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}
const trial = (...args) =>
  cli("auth", "trial", "--bounded", "--json", "--base-url", base, "--allow-unencrypted-storage", ...args);
function server() {
  const state = { stage: "missing", prepare: 0, activate: 0, read: 0, proofs: new Set() };
  globalThis.fetch = async (url, options) => {
    const proof = options.headers.Authorization.slice(7);
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    state.proofs.add(proof);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(readConfig().trial_registration_secret.possession_token, proof);
    assert.equal(JSON.stringify(readConfig().trial_registration).includes(proof), false);
    if (String(url).endsWith("/session")) {
      state.read++;
      return response(view(state.stage));
    }
    if (String(url).endsWith("/prepare")) {
      state.prepare++;
      state.stage = "prepared";
      return response(view("prepared"), 201);
    }
    if (String(url).endsWith("/activate")) {
      state.activate++;
      state.stage = "active";
      return response({ ...view("active"), api_key: key, agent_id: agentId }, 201);
    }
    assert.fail("Unexpected trial route");
  };
  return state;
}

test("persists proof before network, stores the issued key and exports only explicitly", () =>
  isolated(async () => {
    const state = server();
    const result = await trial("--agent-name", "QA agent");
    assert.equal(result.exit, 0, result.output);
    const data = JSON.parse(result.output);
    assert.equal(data.policy, "bounded_agent_trial_v1");
    assert.equal(data.trial_credits, 17.25);
    assert.equal(data.hard_final_cost_cap, false);
    assert.equal(data.claim_url, "https://bounded.example.test/claim?mode=bounded");
    const proof = [...state.proofs][0];
    assert.equal(result.output.includes(proof), false);
    assert.equal(result.output.includes(key), false);
    assert.equal((await trial()).exit, 0);
    assert.equal(state.activate, 1);
    const exported = JSON.parse((await cli("auth", "trial", "--bounded", "--export")).output);
    assert.equal(exported.api_key, key);
    assert.equal(exported.claim_code, proof);
    for (const args of [
      ["config", "list", "--json"],
      ["auth", "status", "--json"],
    ]) {
      const publicResult = await cli(...args);
      assert.equal(publicResult.output.includes(key), false);
      assert.equal(publicResult.output.includes(proof), false);
    }
  }));

test("known active recovery never registers or activates again and can privately export proof", () =>
  isolated(async () => {
    const state = server();
    const delegate = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const reply = await delegate(url, options);
      if (String(url).endsWith("/activate")) throw new Error("lost response");
      return reply;
    };
    assert.equal((await trial()).exit, 75);
    const operation = getTrialRegistration().operation_id;
    const recovered = await trial();
    assert.equal(recovered.exit, 75);
    assert.ok(recovered.output.includes("TRIAL_KEY_RECOVERY_REQUIRED"));
    assert.equal(getTrialRegistration().operation_id, operation);
    assert.equal(state.prepare, 1);
    assert.equal(state.activate, 1);
    assert.equal(state.read, 1);
    assert.equal(state.proofs.size, 1);
    const exported = JSON.parse((await cli("auth", "trial", "--export")).output);
    assert.equal(exported.session_token, [...state.proofs][0]);
    assert.equal(exported.api_key, undefined);
  }));

test("prepared recovery reuses the same possession and operation instead of a new identity", () =>
  isolated(async () => {
    const state = server();
    const delegate = globalThis.fetch;
    let fail = true;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/activate") && fail) {
        fail = false;
        throw new Error("not submitted");
      }
      return delegate(url, options);
    };
    assert.equal((await trial()).exit, 75);
    const operation = getTrialRegistration().operation_id;
    assert.equal((await trial()).exit, 0);
    assert.equal(getTrialRegistration().operation_id, operation);
    assert.equal(state.prepare, 1);
    assert.equal(state.activate, 1);
    assert.equal(state.proofs.size, 1);
  }));

test("existing credentials, invalid name and unavailable secure storage block before network", () =>
  isolated(async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("unexpected");
    };
    writeConfig({ api_key: randomUUID() });
    assert.notEqual((await trial()).exit, 0);
    writeConfig({});
    assert.notEqual((await trial("--agent-name", " ")).exit, 0);
    assert.notEqual((await cli("auth", "trial", "--bounded", "--json", "--base-url", base)).exit, 0);
    assert.equal(calls, 0);
  }));

test("endpoint mismatch never sends the stored proof to another server", () =>
  isolated(async () => {
    const state = server();
    assert.equal((await trial()).exit, 0);
    assert.notEqual(
      (await cli("auth", "trial", "--bounded", "--json", "--base-url", "https://other.example.test/api/v1")).exit,
      0,
    );
    assert.equal(state.activate, 1);
    assert.equal(state.read, 0);
  }));

test("unsupported endpoints never silently fall back to legacy registration", () =>
  isolated(async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response("not found", { status: 404 });
    };
    const result = await trial();
    assert.equal(result.exit, 75);
    assert.ok(result.output.includes("TRIAL_BOUNDED_UNAVAILABLE"));
    assert.equal(urls.length, 1);
    assert.ok(urls[0].endsWith("/agent/trial/prepare"));
    assert.equal(getTrialRegistration().state, "unknown");
  }));

test("a regular login during preparation prevents anonymous activation", () =>
  isolated(async () => {
    const state = server();
    const delegate = globalThis.fetch;
    const formal = randomUUID();
    globalThis.fetch = async (url, options) => {
      const result = await delegate(url, options);
      if (String(url).endsWith("/prepare")) writeConfig({ ...readConfig(), api_key: formal });
      return result;
    };
    const result = await trial();
    assert.notEqual(result.exit, 0);
    assert.equal(state.activate, 0);
    assert.equal(readConfig().api_key, formal);
  }));

test("a confirmed claimed recovery is terminal, not a new registration", () =>
  isolated(async () => {
    const state = server();
    const delegate = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/activate")) throw new Error("unknown activation");
      return delegate(url, options);
    };
    assert.equal((await trial()).exit, 75);
    const operation = getTrialRegistration().operation_id;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: "failure", data: { error: { code: "trial_claimed" } } }), { status: 410 });
    const result = await trial();
    assert.notEqual(result.exit, 0);
    assert.equal(getTrialRegistration().state, "claimed");
    assert.equal(getTrialRegistration().operation_id, operation);
    globalThis.fetch = async () => assert.fail("Terminal trial must not issue or query a new identity");
    assert.notEqual((await trial()).exit, 0);
    const proof = JSON.parse((await cli("auth", "trial", "--export")).output).session_token;
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(state.activate, 0);
  }));
