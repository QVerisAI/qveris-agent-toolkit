import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authorizationContextForApiKey,
  authorizationContextForOAuth,
  deriveLegacyOAuthAuthorizationContextId,
} from "../src/auth/context.mjs";
import { readSessionForContext, writeSession } from "../src/session/session.mjs";

test("authorization context fingerprints are stable without exposing credentials", () => {
  const first = authorizationContextForApiKey("sk-account-a-secret");
  assert.equal(first, authorizationContextForApiKey("sk-account-a-secret"));
  assert.notEqual(first, authorizationContextForApiKey("sk-account-b-secret"));
  assert.equal(first.includes("sk-account-a-secret"), false);

  const metadata = { issuer: "https://unit.test", authorization_context_id: "login-a" };
  assert.equal(
    authorizationContextForOAuth(metadata, { refresh_token: "old-refresh" }),
    authorizationContextForOAuth(metadata, { refresh_token: "rotated-refresh" }),
  );
  assert.notEqual(
    authorizationContextForOAuth(metadata, { refresh_token: "old-refresh" }),
    authorizationContextForOAuth(
      { ...metadata, authorization_context_id: "login-b" },
      { refresh_token: "old-refresh" },
    ),
  );
});

test("legacy OAuth context can be pinned before refresh-token rotation", () => {
  const metadata = { issuer: "https://unit.test" };
  const secret = { refresh_token: "old-refresh" };
  const legacyId = deriveLegacyOAuthAuthorizationContextId(metadata, secret);
  const before = authorizationContextForOAuth(metadata, secret);
  const after = authorizationContextForOAuth(
    { ...metadata, authorization_context_id: legacyId },
    { refresh_token: "new-refresh" },
  );
  assert.equal(after, before);
  assert.equal(before.includes("old-refresh"), false);

  const invalidStored = authorizationContextForOAuth(
    { ...metadata, authorization_context_id: "invalid context with spaces" },
    secret,
  );
  assert.equal(invalidStored, before);
});

test("stored discovery sessions require exact endpoint and authorization context", () => {
  const previous = process.env.XDG_CONFIG_HOME;
  const configHome = mkdtempSync(join(tmpdir(), "qveris-cli-session-context-"));
  process.env.XDG_CONFIG_HOME = configHome;
  try {
    writeSession({
      discoveryId: "search-a",
      baseUrl: "https://a.test/api/v1",
      authorizationContext: "v1:api-key:account-a",
      results: [{ tool_id: "weather.a" }],
    });

    assert.equal(
      readSessionForContext({
        baseUrl: "https://a.test/api/v1",
        authorizationContext: "v1:api-key:account-a",
      }).status,
      "match",
    );
    assert.equal(
      readSessionForContext({
        baseUrl: "https://b.test/api/v1",
        authorizationContext: "v1:api-key:account-a",
      }).status,
      "context_mismatch",
    );
    assert.equal(
      readSessionForContext({
        baseUrl: "https://a.test/api/v1",
        authorizationContext: "v1:api-key:account-b",
      }).status,
      "context_mismatch",
    );

    writeSession({});
    assert.equal(
      readSessionForContext({
        baseUrl: "https://a.test/api/v1",
        authorizationContext: "v1:api-key:account-a",
      }).status,
      "missing",
    );
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    rmSync(configHome, { recursive: true, force: true });
  }
});
