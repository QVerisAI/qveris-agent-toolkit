import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createTrialStorage, beginTrialRegistration, getTrialRegistration } from "../src/auth/trial-storage.mjs";
import {
  resolveApiKey,
  resolveAuthorizationContextId,
  createAuthorizationContextCredentialProvider,
} from "../src/client/auth.mjs";
import { discoverTools, resolveApiBaseUrl } from "../src/client/api.mjs";
import { localPreflight } from "../src/client/preflight.mjs";
import { getConfigPath, readConfig, writeConfig } from "../src/config/store.mjs";
import { main } from "../src/main.mjs";

const base = "https://trial.example.test/api/v1";
const existingKey = randomUUID();
const concurrentKey = randomUUID();
const issued = {
  api_key: randomUUID(),
  claim_code: randomUUID(),
  agent_id: "agent-fixture",
  trial_credits: 75.125,
  expires_at: "2099-12-31T00:00:00Z",
};
const reply = () => new Response(JSON.stringify({ status: "success", status_code: 0, data: issued }), { status: 200 });

async function isolated(fn) {
  const dir = mkdtempSync(join(tmpdir(), "trial-cli-"));
  const names = ["XDG_CONFIG_HOME", "QVERIS_API_KEY", "QVERIS_BASE_URL", "QVERIS_DISABLE_KEYRING", "NO_COLOR"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const fetch = globalThis.fetch;
  const exitCode = process.exitCode;
  process.env.XDG_CONFIG_HOME = dir;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  process.env.NO_COLOR = "1";
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  try {
    await fn(dir);
  } finally {
    globalThis.fetch = fetch;
    process.exitCode = exitCode;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

async function cli(...args) {
  let stdout = "",
    stderr = "";
  const out = process.stdout.write,
    err = process.stderr.write;
  process.stdout.write = (chunk) => {
    if (typeof chunk !== "string") return out.call(process.stdout, chunk);
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    if (typeof chunk !== "string") return err.call(process.stderr, chunk);
    stderr += chunk;
    return true;
  };
  process.exitCode = 0;
  try {
    await main(["node", "qveris", ...args]);
    return { stdout, stderr, exit: process.exitCode };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}
const register = (...args) =>
  cli("auth", "trial", "--json", "--base-url", base, "--allow-unencrypted-storage", ...args);
function noSecrets(output) {
  assert.ok(!output.includes(issued.api_key));
  assert.ok(!output.includes(issued.claim_code));
}

function faultStorage() {
  let config = {},
    password = null,
    fail = false;
  const entry = {
    setPassword(value) {
      password = value;
    },
    getPassword() {
      return password;
    },
    deletePassword() {
      password = null;
    },
  };
  const store = createTrialStorage({
    read: () => structuredClone(config),
    write(value) {
      if (fail) throw new Error("disk unavailable");
      config = structuredClone(value);
    },
    lock: async (fn) => fn(),
    entryFor: async () => entry,
    hasOAuth: () => Boolean(config.oauth_session),
  });
  return {
    store,
    fail(value) {
      fail = value;
    },
    config: () => config,
    password: () => password,
    setConfig(value) {
      config = value;
    },
  };
}

test("actual dispatch issues once, preserves non-50 terms, uses stored credentials, and exports only explicitly", () =>
  isolated(async () => {
    let registrations = 0,
      discovery = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/agent/anonymous-register")) {
        registrations++;
        assert.equal(options.redirect, "error");
        assert.deepEqual(JSON.parse(options.body), { agent_name: "Test agent" });
        assert.equal(readConfig().trial_registration.state, "pending");
        return reply();
      }
      discovery++;
      assert.equal(String(url).startsWith(base), true);
      assert.equal(options.headers.Authorization, `Bearer ${issued.api_key}`);
      return new Response(
        JSON.stringify({ status: "success", status_code: 0, data: { tools: [], discovery_id: "fixture" } }),
      );
    };
    const first = await register("--agent-name=Test agent");
    assert.equal(first.exit, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.trial_credits, 75.125);
    assert.equal(result.expires_at, issued.expires_at);
    assert.equal(result.policy, "legacy_agent_trial");
    assert.equal(result.strict_credit_budget, false);
    noSecrets(first.stdout + first.stderr);
    noSecrets((await register()).stdout);
    assert.equal(registrations, 1);
    if (process.platform !== "win32") {
      assert.equal(statSync(getConfigPath()).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(getConfigPath())).mode & 0o777, 0o700);
    }
    assert.ok(readFileSync(getConfigPath(), "utf8").includes(issued.api_key));
    assert.equal(resolveApiKey(), undefined);
    assert.equal(resolveApiBaseUrl({ preferOAuth: true }).baseUrl, base);
    assert.equal(localPreflight().authType, "trial");
    const authorizationContext = await resolveAuthorizationContextId();
    const provider = createAuthorizationContextCredentialProvider({ authorizationContext });
    assert.equal(provider.refreshCredential, undefined);
    await discoverTools({ credentialProvider: provider, baseUrl: base, query: "fixture" });
    const whoami = await cli("whoami", "--json");
    assert.equal(JSON.parse(whoami.stdout).source, "trial registration");
    const status = await cli("auth", "status", "--json");
    assert.equal(JSON.parse(status.stdout).validation, "not_checked");
    noSecrets(status.stdout + (await cli("config", "list", "--json")).stdout);
    const exported = JSON.parse((await cli("auth", "trial", "--export")).stdout);
    assert.equal(exported.api_key, issued.api_key);
    assert.equal(exported.claim_code, issued.claim_code);
    await assert.rejects(provider.getCredential({ resource: `${base}/other` }), /endpoint/);
    writeConfig({ ...readConfig(), api_key: existingKey });
    assert.equal(resolveApiKey(), existingKey);
    assert.equal(discovery, 2);
  }));

test("ordinary read-only commands never register or invent credentials", () =>
  isolated(async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("unexpected network");
    };
    assert.equal((await cli("whoami", "--json")).exit, 78);
    await cli("auth", "status", "--json");
    await cli("doctor", "--json");
    await cli("discover", "fixture", "--json");
    assert.equal(requests, 0);
    assert.equal(getTrialRegistration(), null);
  }));

test("existing key, environment key, OAuth, or missing secure storage stop registration before POST", () =>
  isolated(async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return reply();
    };
    for (const config of [
      { api_key: existingKey },
      { oauth_session: { storage: "config", issuer: "https://fixture.test" } },
    ]) {
      writeConfig(config);
      assert.equal((await register()).exit, 78);
      assert.deepEqual(readConfig(), config);
    }
    writeConfig({});
    process.env.QVERIS_API_KEY = randomUUID();
    assert.equal((await register()).exit, 78);
    delete process.env.QVERIS_API_KEY;
    assert.equal((await cli("auth", "trial", "--json", "--base-url", base)).exit, 78);
    assert.equal((await register(`--api-key=${randomUUID()}`)).exit, 78);
    assert.equal(requests, 0);
  }));

test("unknown outcomes and crashes never resend, including a fresh command invocation", () =>
  isolated(async () => {
    for (const outcome of [
      () => {
        throw new Error("lost reply");
      },
      () => new Response("unavailable", { status: 503 }),
      () => new Response("bad JSON"),
      () =>
        new Response(JSON.stringify({ status: "success", status_code: 0, data: { ...issued, trial_credits: "75" } })),
    ]) {
      writeConfig({});
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return outcome();
      };
      assert.equal((await register()).exit, 75);
      assert.equal(getTrialRegistration().state, "unknown");
      assert.equal((await register()).exit, 75);
      assert.equal((await cli("auth", "trial", "--export")).exit, 75);
      assert.equal(requests, 1);
    }
  }));

test("explicit rejected registration can be retried; invalid local input never starts it", () =>
  isolated(async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return requests === 1 ? new Response("rejected", { status: 422 }) : reply();
    };
    assert.notEqual((await register("--agent-name", " ")).exit, 0);
    assert.equal(getTrialRegistration(), null);
    assert.notEqual((await register()).exit, 0);
    assert.equal(getTrialRegistration().state, "rejected");
    assert.equal((await register()).exit, 0);
    assert.equal(requests, 2);
  }));

test("concurrent regular login is preserved and prevents trial activation", () =>
  isolated(async () => {
    globalThis.fetch = async () => {
      writeConfig({ ...readConfig(), api_key: concurrentKey });
      return reply();
    };
    const result = await register();
    assert.equal(result.exit, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).active, false);
    assert.equal(resolveApiKey(), concurrentKey);
    assert.equal(JSON.parse((await cli("auth", "trial", "--export")).stdout).api_key, issued.api_key);
  }));

test("Keyring success survives metadata failure and supports export before local finalization", () =>
  isolated(async () => {
    const f = faultStorage();
    const { registration } = await f.store.beginTrialRegistration({ baseUrl: base });
    f.fail(true);
    await assert.rejects(f.store.persistTrialCredential(registration, issued), /disk unavailable/);
    assert.equal(JSON.parse(f.password()).data.trial_credits, 75.125);
    assert.equal(f.config().trial_registration.state, "pending");
    const exported = await f.store.exportTrialCredential();
    assert.equal(exported.secret.api_key, issued.api_key);
    assert.equal(exported.registration.recovery_pending, true);
    assert.equal(exported.registration.active, false);
    f.fail(false);
    f.setConfig({ ...f.config(), api_key: concurrentKey });
    const recovered = await f.store.recoverTrialRegistration();
    assert.equal(recovered.operation_id, registration.operation_id);
    assert.equal(recovered.active, false);
    assert.equal(recovered.trial_credits, 75.125);
    await f.store.recordTrialFailure(registration);
    assert.equal(f.config().trial_registration.state, "issued");
    assert.equal((await f.store.loadTrialSecret()).claim_code, issued.claim_code);
  }));

test("provisional Keyring data is not an issued account and cannot be exported", () =>
  isolated(async () => {
    const f = faultStorage();
    await f.store.beginTrialRegistration({ baseUrl: base });
    await assert.rejects(f.store.exportTrialCredential(), { code: "TRIAL_ISSUANCE_UNKNOWN" });
    assert.equal((await f.store.recoverTrialRegistration()).state, "pending");
  }));

test("expiry and logout prevent further use and never create a replacement account", () =>
  isolated(async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return reply();
    };
    await register();
    const registration = getTrialRegistration();
    writeConfig({ ...readConfig(), trial_registration: { ...registration, expires_at: "2000-01-01T00:00:00Z" } });
    const { resolveCredentialProvider } = await import("../src/client/auth.mjs");
    await assert.rejects(resolveCredentialProvider().getCredential({ resource: base }), { code: "TRIAL_EXPIRED" });
    const logout = await cli("auth", "logout", "--json");
    assert.equal(logout.exit, 0);
    assert.equal(JSON.parse(logout.stdout).revoked, false);
    assert.equal(JSON.parse(logout.stdout).oauth_revoked, null);
    assert.equal(JSON.parse(logout.stdout).trial_revocation, "not_attempted");
    assert.equal(readConfig().trial_registration_secret, undefined);
    assert.equal(getTrialRegistration().state, "logged_out");
    assert.equal((await register()).exit, 75);
    assert.equal(requests, 1);
  }));

test("unresolved issuance blocks logout/reset rather than dropping the in-flight recovery journal", () =>
  isolated(async () => {
    globalThis.fetch = async () => {
      throw new Error("reply lost");
    };
    await register();
    const original = readConfig();
    assert.equal((await cli("config", "reset", "--json")).exit, 75);
    assert.deepEqual(readConfig(), original);
    assert.equal((await cli("logout", "--json")).exit, 75);
    assert.deepEqual(readConfig(), original);
    const output = await register();
    assert.equal(JSON.parse(output.stderr).action, "recover_registration");
    assert.equal(JSON.parse(output.stderr).retryable, false);
  }));

test("a failure envelope without definite HTTP rejection remains unknown", () =>
  isolated(async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ status: "failure", message: issued.api_key }));
    };
    const result = await register();
    assert.equal(result.exit, 75);
    noSecrets(result.stdout + result.stderr);
    assert.equal((await register()).exit, 75);
    assert.equal(requests, 1);
  }));

test("atomic rename followed by an error does not downgrade an issued record", () =>
  isolated(async () => {
    let config = {},
      password;
    let failAfterWrite = false;
    const store = createTrialStorage({
      read: () => structuredClone(config),
      write(value) {
        config = structuredClone(value);
        if (failAfterWrite) throw new Error("chmod failed after rename");
      },
      entryFor: async () => ({
        setPassword(value) {
          password = value;
        },
        getPassword: () => password,
      }),
      lock: async (fn) => fn(),
      hasOAuth: () => false,
    });
    const { registration } = await store.beginTrialRegistration({ baseUrl: base });
    failAfterWrite = true;
    await assert.rejects(store.persistTrialCredential(registration, issued), /chmod failed/);
    await store.recordTrialFailure(registration);
    assert.equal(store.getTrialRegistration().state, "issued");
    assert.equal((await store.exportTrialCredential()).secret.api_key, issued.api_key);
  }));

test("recovery binds saved response to the original operation and endpoint", () =>
  isolated(async () => {
    for (const changed of [{ base_url: `${base}/other` }, { operation_id: "other-operation" }]) {
      const f = faultStorage();
      const { registration } = await f.store.beginTrialRegistration({ baseUrl: base });
      await f.store.persistTrialCredential(registration, issued);
      f.setConfig({
        ...f.config(),
        trial_registration: { ...f.config().trial_registration, ...changed, state: "unknown" },
      });
      await assert.rejects(f.store.persistTrialCredential(registration, issued), { code: "TRIAL_STORAGE_FAILED" });
      await assert.rejects(f.store.recoverTrialRegistration(), { code: "TRIAL_STORAGE_FAILED" });
      await assert.rejects(f.store.exportTrialCredential(), { code: "TRIAL_STORAGE_FAILED" });
    }
  }));

test("shared file lock permits only one concurrent registration intent", () =>
  isolated(async () => {
    const results = await Promise.all([
      beginTrialRegistration({ baseUrl: base, allowUnencryptedStorage: true }),
      beginTrialRegistration({ baseUrl: base, allowUnencryptedStorage: true }),
    ]);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(results[0].registration.operation_id, results[1].registration.operation_id);
  }));

test("a process restart preserves unknown outcome and never POSTs again", () =>
  isolated(async () => {
    const mainUrl = new URL("../src/main.mjs", import.meta.url).href;
    const script = `import { main } from ${JSON.stringify(mainUrl)}; globalThis.fetch = async () => { process.stderr.write('REGISTRATION_POST\\n'); throw new Error('lost reply'); }; await main(['node', 'qveris', 'auth', 'trial', '--json', '--allow-unencrypted-storage', '--base-url', ${JSON.stringify(base)}]);`;
    const run = () => {
      try {
        return {
          stdout: execFileSync(process.execPath, ["--input-type=module", "-e", script], {
            env: process.env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }),
          stderr: "",
        };
      } catch (error) {
        assert.equal(error.status, 75);
        return { stdout: error.stdout, stderr: error.stderr };
      }
    };
    const first = run();
    assert.match(first.stderr, /REGISTRATION_POST/);
    const operation = getTrialRegistration().operation_id;
    const second = run();
    assert.doesNotMatch(second.stderr, /REGISTRATION_POST/);
    assert.match(second.stderr, /TRIAL_ISSUANCE_UNKNOWN/);
    assert.equal(getTrialRegistration().operation_id, operation);
    noSecrets(first.stdout + first.stderr + second.stdout + second.stderr);
  }));
