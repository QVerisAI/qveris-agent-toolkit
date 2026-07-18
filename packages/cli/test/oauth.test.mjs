import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_CODE_GRANT,
  createStoredOAuthCredentialProvider,
  discoverAuthorizationServer,
  pollDeviceToken,
  refreshOAuthSession,
  revokeOAuthToken,
  startDeviceAuthorization,
} from "../src/auth/oauth.mjs";
import { deleteOAuthSession, getOAuthSessionMetadata } from "../src/auth/storage.mjs";

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

test("OAuth discovery requires matching issuer, Device Flow, and a public client", async () => {
  const metadata = await discoverAuthorizationServer("https://unit.test/api/v1", async () => response(discovery));
  assert.equal(metadata.issuer, "https://unit.test");
  assert.equal(metadata.device_authorization_endpoint, discovery.device_authorization_endpoint);

  await assert.rejects(
    discoverAuthorizationServer("https://unit.test", async () =>
      response({ ...discovery, token_endpoint_auth_methods_supported: ["client_secret_basic"] }),
    ),
    /public QVeris CLI client/,
  );
});

test("Device Authorization sends the registered public client and validates the response", async () => {
  let form;
  const result = await startDeviceAuthorization(
    discovery,
    { scope: "openid offline_access tools.search", resource: "https://unit.test/tools" },
    async (_url, options) => {
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

test("Revocation accepts an empty success response and never puts tokens in the URL", async () => {
  let request;
  await revokeOAuthToken(discovery, "refresh-secret", "refresh_token", async (url, options) => {
    request = { url, form: Object.fromEntries(options.body.entries()) };
    return response(null, 200);
  });
  assert.equal(request.url.includes("refresh-secret"), false);
  assert.equal(request.form.token, "refresh-secret");
  assert.equal(request.form.client_id, "qveris-cli");
});
