import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  DEVICE_CODE_GRANT,
  createStoredOAuthCredentialProvider,
  discoverAuthorizationServer,
  pollDeviceToken,
  refreshOAuthSession,
  revokeOAuthSession,
  revokeOAuthToken,
  startDeviceAuthorization,
  validateOAuthScopes,
} from "../src/auth/oauth.mjs";
import {
  deleteOAuthSession,
  getOAuthSessionMetadata,
  loadOAuthSessionSecret,
  saveOAuthSession,
  withOAuthRefreshLock,
} from "../src/auth/storage.mjs";
import { runAuth } from "../src/commands/auth.mjs";
import { runConfig } from "../src/commands/config.mjs";
import { deleteConfigValue, getConfigPath, getConfigValue, setConfigValue } from "../src/config/store.mjs";

function response(payload, status = 200, headers = {}) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const discovery = {
  issuer: "https://unit.test",
  device_authorization_endpoint: "https://unit.test/oauth/device/authorize",
  token_endpoint: "https://unit.test/oauth/token",
  revocation_endpoint: "https://unit.test/oauth/revoke",
  grant_types_supported: [DEVICE_CODE_GRANT, "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["openid", "offline_access", "tools.search"],
};

test("OAuth discovery requires matching issuer, Device Flow, refresh, and a public client", async () => {
  const metadata = await discoverAuthorizationServer("https://unit.test/api/v1", async (_url, options) => {
    assert.equal(options.redirect, "error");
    return response(discovery);
  });
  assert.equal(metadata.issuer, "https://unit.test");
  assert.equal(metadata.device_authorization_endpoint, discovery.device_authorization_endpoint);

  await assert.rejects(
    discoverAuthorizationServer("javascript:alert(1)", async () => {
      assert.fail("unsafe issuers must be rejected before discovery");
    }),
    /issuer must use HTTPS/,
  );

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, token_endpoint_auth_methods_supported: ["client_secret_basic"] }),
    ),
    /public QVeris CLI client/,
  );

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, grant_types_supported: [DEVICE_CODE_GRANT] }),
    ),
    /Refresh Token Grant/,
  );

  const loopback = await discoverAuthorizationServer("http://[::1]:8787", async () =>
    response({
      ...discovery,
      issuer: "http://[::1]:8787",
      device_authorization_endpoint: "http://[::1]:8787/oauth/device/authorize",
      token_endpoint: "http://[::1]:8787/oauth/token",
      revocation_endpoint: "http://[::1]:8787/oauth/revoke",
    }),
  );
  assert.equal(loopback.issuer, "http://[::1]:8787");

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, token_endpoint: "ftp://localhost/oauth/token" }),
    ),
    /token_endpoint must use HTTPS/,
  );

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, token_endpoint: "https://other.test/oauth/token" }),
    ),
    /token_endpoint does not match the stored issuer/,
  );

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }),
    (error) => error.code === "NET_TIMEOUT" && /OAuth request timed out/.test(error.message),
  );

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, padding: "x".repeat(1024 * 1024) }),
    ),
    /maximum response size/,
  );
});

test("OAuth scopes require offline access and reject unsupported values", () => {
  assert.deepEqual(validateOAuthScopes(discovery, "openid offline_access tools.search"), [
    "openid",
    "offline_access",
    "tools.search",
  ]);
  assert.throws(() => validateOAuthScopes(discovery, "openid tools.search"), /must include offline_access/);
  assert.throws(
    () => validateOAuthScopes(discovery, "openid offline_access tools.execute"),
    /not supported: tools.execute/,
  );
  assert.deepEqual(validateOAuthScopes(discovery, "  openid\n offline_access\ttools.search  "), [
    "openid",
    "offline_access",
    "tools.search",
  ]);
});

test("Device Authorization sends the registered public client and validates the response", async () => {
  let form;
  const result = await startDeviceAuthorization(
    discovery,
    { scope: "openid offline_access tools.search", resource: "https://unit.test/tools" },
    async (_url, options) => {
      assert.equal(options.redirect, "error");
      form = Object.fromEntries(options.body.entries());
      return response({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://unit.test/oauth/device",
        verification_uri_complete: "https://unit.test/oauth/device?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 5,
      });
    },
  );
  assert.deepEqual(form, {
    client_id: "qveris-cli",
    scope: "openid offline_access tools.search",
    resource: "https://unit.test/tools",
  });
  assert.equal(result.device_code, "device-secret");

  await assert.rejects(
    startDeviceAuthorization(discovery, { scope: "openid", resource: "file:///tmp/token" }, async () => {
      assert.fail("unsafe resources must be rejected before authorization");
    }),
    /resource must use HTTPS/,
  );

  await assert.rejects(
    startDeviceAuthorization(discovery, { scope: "openid", resource: "https://unit.test/tools" }, async () =>
      response({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "javascript:alert(1)",
      }),
    ),
    /verification_uri must use HTTPS/,
  );

  await assert.rejects(
    startDeviceAuthorization(discovery, { scope: "openid", resource: "https://unit.test/tools" }, async () =>
      response({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://unit.test/oauth/device",
        verification_uri_complete: "https://phishing.test/oauth/device?user_code=ABCD-EFGH",
        expires_in: 600,
      }),
    ),
    /verification_uri_complete does not match/,
  );

  await assert.rejects(
    startDeviceAuthorization(discovery, { scope: "openid", resource: "https://unit.test/tools" }, async () =>
      response({
        device_code: "device-secret",
        user_code: "ABCD\u001b[2J",
        verification_uri: "https://unit.test/oauth/device",
        expires_in: 600,
      }),
    ),
    /invalid user_code/,
  );
});

test("Device polling honors pending and slow_down before returning tokens", async () => {
  const replies = [
    response({ error: "authorization_pending" }, 400),
    response({ error: "slow_down" }, 400),
    response({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      token_type: "Bearer",
      expires_in: 3600,
    }),
  ];
  const waits = [];
  const tokens = await pollDeviceToken(
    discovery,
    { device_code: "device-secret", expires_in: 600, interval: 5 },
    {
      fetchImpl: async () => replies.shift(),
      sleep: async (ms) => waits.push(ms),
      now: () => 0,
    },
  );
  assert.deepEqual(waits, [5000, 5000, 10000]);
  assert.equal(tokens.access_token, "access-secret");
});

test("Device polling rejects a success response without a refresh token", async () => {
  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () => response({ access_token: "access-secret", token_type: "Bearer", expires_in: 3600 }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /required refresh token/,
  );

  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () =>
          response({
            access_token: "access-secret\nInjected: value",
            refresh_token: "refresh-secret",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /invalid access token response/,
  );

  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () =>
          response({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            token_type: "Bearer",
            expires_in: 3600,
            resource: "javascript:alert(1)",
          }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /resource must use HTTPS/,
  );

  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () =>
          response({
            access_token: "x".repeat(16385),
            refresh_token: "refresh-secret",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /invalid access token response/,
  );
});

test("Device and token responses reject invalid expiry values", async () => {
  await assert.rejects(
    startDeviceAuthorization(
      discovery,
      { scope: "openid offline_access", resource: "https://unit.test/tools" },
      async () =>
        response({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "https://unit.test/oauth/device",
          expires_in: 0,
        }),
    ),
    /invalid expires_in/,
  );

  await assert.rejects(
    startDeviceAuthorization(
      discovery,
      { scope: "openid offline_access", resource: "https://unit.test/tools" },
      async () =>
        response({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "https://unit.test/oauth/device",
          expires_in: Number.MAX_VALUE,
        }),
    ),
    /invalid expires_in/,
  );

  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () =>
          response({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            token_type: "Bearer",
          }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /invalid expires_in/,
  );

  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 600, interval: 1 },
      {
        fetchImpl: async () =>
          response({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            token_type: "Bearer",
            expires_in: Number.MAX_VALUE,
          }),
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /invalid expires_in/,
  );
});

test("Device polling does not call the token endpoint after authorization expires", async () => {
  let currentTime = 0;
  let requests = 0;
  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 1, interval: 5 },
      {
        fetchImpl: async () => {
          requests += 1;
          return response({ error: "authorization_pending" }, { ok: false, status: 400 });
        },
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
        now: () => currentTime,
      },
    ),
    /expired/,
  );
  assert.equal(currentTime, 1000);
  assert.equal(requests, 0);
});

test("Device polling bounds an in-flight token request by the authorization deadline", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 0.02, interval: 0.001 },
      {
        fetchImpl: async (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      },
    ),
    /expired/,
  );
  assert.ok(Date.now() - startedAt < 1000);
});

test("Device polling timeout also covers a response body that stalls after headers", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    pollDeviceToken(
      discovery,
      { device_code: "device-secret", expires_in: 0.02, interval: 0.001 },
      {
        fetchImpl: async (_url, options) =>
          new Response(
            new ReadableStream({
              start(controller) {
                options.signal.addEventListener("abort", () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  controller.error(error);
                });
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ),
    /expired/,
  );
  assert.ok(Date.now() - startedAt < 1000);
});

for (const code of ["access_denied", "expired_token", "invalid_grant"]) {
  test(`Device polling stops on ${code}`, async () => {
    await assert.rejects(
      pollDeviceToken(
        discovery,
        { device_code: "device-secret", expires_in: 600, interval: 1 },
        {
          fetchImpl: async () => response({ error: code, error_description: "stopped" }, 400),
          sleep: async () => {},
          now: () => 0,
        },
      ),
      (error) => error.oauthCode === code && !error.message.includes("device-secret"),
    );
  });
}

test("Refresh uses the public client and rotates the refresh token", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-test-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  try {
    let form;
    const result = await refreshOAuthSession(
      { ...discovery, api_base_url: "https://unit.test/api/v1", resource: "https://unit.test/tools" },
      { access_token: "old-access", refresh_token: "old-refresh" },
      async (_url, options) => {
        form = Object.fromEntries(options.body.entries());
        return response({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    );
    assert.deepEqual(form, {
      grant_type: "refresh_token",
      client_id: "qveris-cli",
      refresh_token: "old-refresh",
    });
    assert.equal(result.secret.refresh_token, "new-refresh");
    assert.equal(getOAuthSessionMetadata().storage, "session");
  } finally {
    await deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Refresh rejects a response that violates the QVeris rotation contract", async () => {
  await assert.rejects(
    refreshOAuthSession(
      { ...discovery, api_base_url: "https://unit.test/api/v1", resource: "https://unit.test/tools" },
      { access_token: "old-access", refresh_token: "old-refresh" },
      async () => response({ access_token: "new-access", token_type: "Bearer", expires_in: 3600 }),
    ),
    /did not rotate the refresh token/,
  );

  await assert.rejects(
    refreshOAuthSession(
      { ...discovery, api_base_url: "https://unit.test/api/v1", resource: "https://unit.test/tools" },
      { access_token: "old-access", refresh_token: "same-refresh" },
      async () =>
        response({
          access_token: "new-access",
          refresh_token: "same-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    ),
    /did not rotate the refresh token/,
  );
});

test("Refresh reports when a previously persisted session cannot store rotated credentials", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-persist-failure-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  try {
    await assert.rejects(
      refreshOAuthSession(
        {
          ...discovery,
          storage: "keyring",
          api_base_url: "https://unit.test/api/v1",
          resource: "https://unit.test/tools",
        },
        { access_token: "old-access", refresh_token: "old-refresh" },
        async () =>
          response({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
      ),
      /could not be persisted/,
    );
  } finally {
    await deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Keyring deletion failure retains issuer metadata for a later cleanup retry", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-keyring-cleanup-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  const isolatedStorage = await import(`../src/auth/storage.mjs?cleanup=${process.pid}-${Date.now()}`);
  try {
    setConfigValue("oauth_session", { ...discovery, storage: "keyring" });
    await assert.rejects(isolatedStorage.deleteOAuthSession(), /credential store is unavailable/);
    assert.equal(isolatedStorage.getOAuthSessionMetadata({ fresh: true }).storage, "keyring");
    assert.equal(await isolatedStorage.loadOAuthSessionSecret(undefined, { fresh: true }), null);
  } finally {
    deleteConfigValue("oauth_session");
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("OAuth logout reports incomplete local deletion and unknown remote revocation", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  const lines = [];
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-logout-cleanup-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  console.log = (...args) => lines.push(args.join(" "));
  try {
    setConfigValue("oauth_session", { ...discovery, storage: "keyring" });
    process.exitCode = undefined;
    await runAuth("logout", { json: true });
    const result = JSON.parse(lines.join("\n"));
    assert.deepEqual(result, { authenticated: false, local_credentials_removed: false, revoked: false });
    assert.equal(process.exitCode, 1);
    assert.equal(getOAuthSessionMetadata({ fresh: true }).storage, "keyring");
  } finally {
    console.log = previousLog;
    deleteConfigValue("oauth_session");
    process.exitCode = previousExitCode;
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Logout waits for an in-flight refresh and revokes the rotated session", async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousFetch = globalThis.fetch;
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-logout-refresh-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  console.log = () => {};
  let releaseRefresh;
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: 0,
      },
      { access_token: "expired-access", refresh_token: "old-refresh" },
      { allowUnencryptedStorage: true },
    );
    let markRefreshStarted;
    const refreshStarted = new Promise((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    const provider = createStoredOAuthCredentialProvider({
      fetchImpl: async () => {
        markRefreshStarted();
        await refreshGate;
        return response({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    });
    const credential = provider.getCredential({ resource: "https://unit.test/api/v1", scopes: [] });
    await refreshStarted;

    const revokedTokens = [];
    globalThis.fetch = async (_url, options) => {
      revokedTokens.push(Object.fromEntries(options.body.entries()).token);
      return response(null);
    };
    const logout = runAuth("logout", { json: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(revokedTokens, []);

    releaseRefresh();
    assert.equal(await credential, "fresh-access");
    await logout;
    assert.deepEqual(revokedTokens, ["fresh-refresh", "fresh-access"]);
    assert.equal(getOAuthSessionMetadata({ fresh: true }), null);
  } finally {
    releaseRefresh?.();
    console.log = previousLog;
    globalThis.fetch = previousFetch;
    process.exitCode = previousExitCode;
    if (getOAuthSessionMetadata({ fresh: true })) await deleteOAuthSession();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Config writes wait for refresh rotation without restoring stale OAuth credentials", async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousLog = console.log;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-config-refresh-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  console.log = () => {};
  let releaseRefresh;
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: 0,
      },
      { access_token: "expired-access", refresh_token: "old-refresh" },
      { allowUnencryptedStorage: true },
    );
    let markRefreshStarted;
    const refreshStarted = new Promise((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    const provider = createStoredOAuthCredentialProvider({
      fetchImpl: async () => {
        markRefreshStarted();
        await refreshGate;
        return response({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    });
    const credential = provider.getCredential({ resource: "https://unit.test/api/v1", scopes: [] });
    await refreshStarted;

    const configWrite = runConfig("set", ["api_key", "sk-config"], {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(getConfigValue("api_key"), undefined);

    releaseRefresh();
    assert.equal(await credential, "fresh-access");
    await configWrite;
    assert.equal(getConfigValue("api_key"), "sk-config");
    assert.deepEqual(await loadOAuthSessionSecret(undefined, { fresh: true }), {
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
    });
  } finally {
    releaseRefresh?.();
    console.log = previousLog;
    if (getOAuthSessionMetadata({ fresh: true })) await deleteOAuthSession();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Config reset revokes and removes a stored OAuth session", async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-config-reset-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  console.log = () => {};
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: Date.now() + 3600000,
      },
      { access_token: "access-secret", refresh_token: "refresh-secret" },
      { allowUnencryptedStorage: true },
    );
    setConfigValue("api_key", "sk-config");
    const revokedTokens = [];
    globalThis.fetch = async (_url, options) => {
      revokedTokens.push(Object.fromEntries(options.body.entries()).token);
      return response(null);
    };

    await runConfig("reset", [], {});

    assert.deepEqual(revokedTokens, ["refresh-secret", "access-secret"]);
    assert.equal(getOAuthSessionMetadata({ fresh: true }), null);
    assert.equal(getConfigValue("api_key"), undefined);
  } finally {
    console.log = previousLog;
    globalThis.fetch = previousFetch;
    if (getOAuthSessionMetadata({ fresh: true })) await deleteOAuthSession();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Explicit config fallback persists across processes with owner-only permissions", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const configHome = `/tmp/qveris-oauth-fallback-${process.pid}-${Date.now()}`;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  const suffix = `${process.pid}-${Date.now()}`;
  const writer = await import(`../src/auth/storage.mjs?writer=${suffix}`);
  const reader = await import(`../src/auth/storage.mjs?reader=${suffix}`);
  try {
    await writer.saveOAuthSession(
      { ...discovery, expires_at: Date.now() + 3600000 },
      { access_token: "access-secret", refresh_token: "refresh-secret" },
      { allowUnencryptedStorage: true },
    );
    const metadata = reader.getOAuthSessionMetadata();
    assert.equal(metadata.storage, "config");
    assert.deepEqual(await reader.loadOAuthSessionSecret(metadata), {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
    });
    if (process.platform !== "win32") {
      assert.equal(statSync(join(configHome, "qveris", "config.json")).mode & 0o777, 0o600);
    }
  } finally {
    await reader.deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Concurrent providers coalesce refresh rotation", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-concurrency-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  try {
    const { saveOAuthSession } = await import("../src/auth/storage.mjs");
    await saveOAuthSession(
      {
        ...discovery,
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: 0,
      },
      { access_token: "expired-access", refresh_token: "old-refresh" },
    );
    let refreshes = 0;
    const fetchImpl = async () => {
      refreshes += 1;
      await Promise.resolve();
      return response({
        access_token: "fresh-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    };
    const first = createStoredOAuthCredentialProvider({ fetchImpl });
    const second = createStoredOAuthCredentialProvider({ fetchImpl });
    const context = { resource: "https://unit.test/api/v1", scopes: [] };
    assert.deepEqual(await Promise.all([first.getCredential(context), second.getCredential(context)]), [
      "fresh-access",
      "fresh-access",
    ]);
    assert.equal(refreshes, 1);
  } finally {
    await deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Independent OAuth module instances serialize persisted refresh rotation", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-process-lock-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  const suffix = `${process.pid}-${Date.now()}`;
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: 0,
      },
      { access_token: "expired-access", refresh_token: "old-refresh" },
      { allowUnencryptedStorage: true },
    );
    const firstModule = await import(`../src/auth/oauth.mjs?first-process=${suffix}`);
    const secondModule = await import(`../src/auth/oauth.mjs?second-process=${suffix}`);
    let refreshes = 0;
    const fetchImpl = async () => {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({
        access_token: "fresh-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    };
    const context = { resource: "https://unit.test/api/v1", scopes: [] };
    const first = firstModule.createStoredOAuthCredentialProvider({ fetchImpl });
    const second = secondModule.createStoredOAuthCredentialProvider({ fetchImpl });
    assert.deepEqual(await Promise.all([first.getCredential(context), second.getCredential(context)]), [
      "fresh-access",
      "fresh-access",
    ]);
    assert.equal(refreshes, 1);
  } finally {
    await deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("A refresh never returns credentials from a session replaced while waiting for the lock", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-session-switch-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  let releaseLock;
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: 0,
      },
      { access_token: "expired-access", refresh_token: "old-refresh" },
      { allowUnencryptedStorage: true },
    );
    let lockAcquired;
    const acquired = new Promise((resolve) => {
      lockAcquired = resolve;
    });
    const release = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const holder = withOAuthRefreshLock(async () => {
      lockAcquired();
      await release;
    });
    await acquired;

    let refreshes = 0;
    const provider = createStoredOAuthCredentialProvider({
      fetchImpl: async () => {
        refreshes += 1;
        return response({
          access_token: "unexpected-access",
          refresh_token: "unexpected-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    });
    const credential = provider.getCredential({ resource: "https://unit.test/api/v1", scopes: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await saveOAuthSession(
      {
        ...discovery,
        issuer: "https://other.test",
        token_endpoint: "https://other.test/oauth/token",
        revocation_endpoint: "https://other.test/oauth/revoke",
        storage: "config",
        api_base_url: "https://other.test/api/v1",
        resource: "https://other.test/tools",
        expires_at: Date.now() + 3600000,
      },
      { access_token: "other-access", refresh_token: "other-refresh" },
      { allowUnencryptedStorage: true },
    );
    releaseLock();
    await holder;
    await assert.rejects(credential, /session changed/);
    assert.equal(refreshes, 0);
  } finally {
    releaseLock?.();
    await deleteOAuthSession();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("A stale refresh lock is reclaimed only when its owning process is gone", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-stale-lock-${process.pid}-${Date.now()}`;
  const lockPath = `${getConfigPath()}.oauth-refresh.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  let currentTime = Date.now();
  try {
    writeFileSync(lockPath, JSON.stringify({ ownerToken: "live-owner", pid: process.pid }));
    const staleTime = new Date(currentTime - 120000);
    utimesSync(lockPath, staleTime, staleTime);
    await assert.rejects(
      withOAuthRefreshLock(async () => assert.fail("a live owner's lock must not be reclaimed"), {
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      }),
      /Timed out waiting/,
    );
    assert.equal(existsSync(lockPath), true);

    unlinkSync(lockPath);
    writeFileSync(lockPath, JSON.stringify({ ownerToken: "dead-owner", pid: 2147483647 }));
    utimesSync(lockPath, staleTime, staleTime);
    assert.equal(
      await withOAuthRefreshLock(async () => "reclaimed", {
        now: () => currentTime,
        sleep: async () => {},
      }),
      "reclaimed",
    );
    assert.equal(existsSync(lockPath), false);
  } finally {
    if (existsSync(lockPath)) unlinkSync(lockPath);
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
});

test(
  "A committed lock callback stays successful when only lock-file cleanup fails",
  { skip: process.platform === "win32" },
  async () => {
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-lock-cleanup-${process.pid}-${Date.now()}`;
    const lockPath = `${getConfigPath()}.oauth-refresh.lock`;
    const configDirectory = dirname(lockPath);
    try {
      const result = await withOAuthRefreshLock(async () => {
        chmodSync(configDirectory, 0o500);
        return "committed";
      });
      assert.equal(result, "committed");
      assert.equal(existsSync(lockPath), true);
    } finally {
      chmodSync(configDirectory, 0o700);
      if (existsSync(lockPath)) unlinkSync(lockPath);
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  },
);

test("Revocation accepts an empty success response and never puts tokens in the URL", async () => {
  let request;
  await revokeOAuthToken(discovery, "refresh-secret", "refresh_token", async (url, options) => {
    assert.equal(options.redirect, "error");
    request = { url, form: Object.fromEntries(options.body.entries()) };
    return response(null, 200);
  });
  assert.equal(request.url.includes("refresh-secret"), false);
  assert.equal(request.form.token, "refresh-secret");
  assert.equal(request.form.client_id, "qveris-cli");
});

test("Session revocation attempts the access token after refresh-token revocation fails", async () => {
  const hints = [];
  let activeRequests = 0;
  let maximumConcurrency = 0;
  await assert.rejects(
    revokeOAuthSession(
      discovery,
      { refresh_token: "refresh-secret", access_token: "access-secret" },
      async (_url, options) => {
        activeRequests += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
        const form = Object.fromEntries(options.body.entries());
        hints.push(form.token_type_hint);
        await new Promise((resolve) => setImmediate(resolve));
        activeRequests -= 1;
        return form.token_type_hint === "refresh_token"
          ? response({ error: "invalid_token" }, 400)
          : response(null, 200);
      },
    ),
    /OAuth request failed/,
  );
  assert.deepEqual(hints, ["refresh_token", "access_token"]);
  assert.equal(maximumConcurrency, 2);
});

test("A successful login revokes the previous OAuth session before replacing it", async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousError = console.error;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-relogin-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  const revokedTokens = [];
  console.log = () => {};
  console.error = () => {};
  try {
    await saveOAuthSession(
      {
        ...discovery,
        storage: "config",
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: Date.now() + 3600000,
      },
      { access_token: "old-access", refresh_token: "old-refresh" },
      { allowUnencryptedStorage: true },
    );
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith("/.well-known/oauth-authorization-server")) return response(discovery);
      if (url === discovery.device_authorization_endpoint) {
        return response({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "https://unit.test/oauth/device",
          expires_in: 30,
          interval: 0.001,
        });
      }
      if (url === discovery.token_endpoint) {
        return response({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url === discovery.revocation_endpoint) {
        revokedTokens.push(Object.fromEntries(options.body.entries()).token);
        return response(null);
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    };

    await runAuth("login", {
      baseUrl: "https://unit.test/api/v1",
      scope: "openid offline_access tools.search",
      resource: "https://unit.test/tools",
      noBrowser: true,
      json: true,
      allowUnencryptedStorage: true,
    });

    assert.deepEqual(revokedTokens, ["old-refresh", "old-access"]);
    assert.deepEqual(await loadOAuthSessionSecret(), {
      access_token: "new-access",
      refresh_token: "new-refresh",
    });
  } finally {
    console.log = previousLog;
    console.error = previousError;
    globalThis.fetch = previousFetch;
    await deleteOAuthSession();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Login aborts without replacing a session that changed during device authorization", async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousError = console.error;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-login-race-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  const revokedTokens = [];
  console.log = () => {};
  console.error = () => {};
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith("/.well-known/oauth-authorization-server")) return response(discovery);
      if (url === discovery.device_authorization_endpoint) {
        return response({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "https://unit.test/oauth/device",
          expires_in: 30,
          interval: 0.001,
        });
      }
      if (url === discovery.token_endpoint) {
        await saveOAuthSession(
          {
            ...discovery,
            issuer: "https://other.test",
            token_endpoint: "https://other.test/oauth/token",
            revocation_endpoint: "https://other.test/oauth/revoke",
            storage: "config",
            api_base_url: "https://other.test/api/v1",
            resource: "https://other.test/tools",
            expires_at: Date.now() + 3600000,
          },
          { access_token: "other-access", refresh_token: "other-refresh" },
          { allowUnencryptedStorage: true },
        );
        return response({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url === discovery.revocation_endpoint) {
        revokedTokens.push(Object.fromEntries(options.body.entries()).token);
        return response(null);
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    };

    await assert.rejects(
      runAuth("login", {
        baseUrl: "https://unit.test/api/v1",
        scope: "openid offline_access tools.search",
        resource: "https://unit.test/tools",
        noBrowser: true,
        json: true,
        allowUnencryptedStorage: true,
      }),
      /session changed/,
    );

    assert.deepEqual(revokedTokens, ["new-refresh", "new-access"]);
    assert.equal(getOAuthSessionMetadata({ fresh: true }).issuer, "https://other.test");
    assert.deepEqual(await loadOAuthSessionSecret(undefined, { fresh: true }), {
      access_token: "other-access",
      refresh_token: "other-refresh",
    });
  } finally {
    console.log = previousLog;
    console.error = previousError;
    globalThis.fetch = previousFetch;
    await deleteOAuthSession();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});

test("Auth status reports validation failures without throwing", async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const previousKeyring = process.env.QVERIS_DISABLE_KEYRING;
  const previousFetch = globalThis.fetch;
  const previousExitCode = process.exitCode;
  const lines = [];
  const previousLog = console.log;
  process.env.XDG_CONFIG_HOME = `/tmp/qveris-oauth-status-${process.pid}-${Date.now()}`;
  process.env.QVERIS_DISABLE_KEYRING = "1";
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await saveOAuthSession(
      {
        ...discovery,
        api_base_url: "https://unit.test/api/v1",
        resource: "https://unit.test/tools",
        expires_at: Date.now() + 3600000,
      },
      { access_token: "access-secret", refresh_token: "refresh-secret" },
    );
    await runAuth("status", { json: true });
    assert.equal(process.exitCode, 1);
    assert.match(lines.join("\n"), /"authenticated": false/);
    assert.match(lines.join("\n"), /network unavailable/);
  } finally {
    console.log = previousLog;
    globalThis.fetch = previousFetch;
    await deleteOAuthSession();
    process.exitCode = previousExitCode;
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousKeyring === undefined) delete process.env.QVERIS_DISABLE_KEYRING;
    else process.env.QVERIS_DISABLE_KEYRING = previousKeyring;
  }
});
