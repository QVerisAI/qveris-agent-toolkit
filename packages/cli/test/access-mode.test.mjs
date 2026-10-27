import assert from "node:assert/strict";
import test from "node:test";

import { resolveAccessMode } from "../src/client/access-mode.mjs";
import {
  authorizationContextForApiKey,
  authorizationContextForOAuth,
  authorizationContextForPublicDiscovery,
} from "../src/auth/context.mjs";

test("missing credentials never opt into public access implicitly", () => {
  assert.equal(resolveAccessMode({ operation: "discover" }), "authenticated");
  assert.equal(resolveAccessMode({ hasCredentials: true, operation: "discover" }), "authenticated");
  assert.throws(() => resolveAccessMode({ publicReadOnly: "true", operation: "discover" }));
});

test("explicit public discovery supports only the two allowed read operations", () => {
  for (const operation of ["discover", "inspect"]) {
    assert.equal(resolveAccessMode({ publicReadOnly: true, operation }), "public-read-only");
  }
  for (const operation of ["probe", "call", "credits", "usage", "ledger", "history", "models", "mcp", undefined]) {
    assert.throws(
      () => resolveAccessMode({ publicReadOnly: true, operation }),
      (error) => error.code === "AUTH_PUBLIC_OPERATION_DENIED",
    );
  }
});

test("credential presence blocks public mode without validating or exposing the secret", () => {
  for (const operation of ["discover", "inspect"]) {
    assert.throws(
      () => resolveAccessMode({ publicReadOnly: true, hasCredentials: true, operation }),
      (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT",
    );
  }
});

test("public mode rejects authentication proof by presence, including empty and duplicate headers", () => {
  for (const headers of [
    { Authorization: "Bearer valid-synthetic" },
    { authorization: "Bearer invalid-synthetic" },
    { AUTHORIZATION: "" },
    { Authorization: "malformed" },
    [
      ["Authorization", ""],
      ["Authorization", "Bearer synthetic"],
    ],
    new Headers({ Authorization: "" }),
    { Cookie: "" },
    new Headers({ cookie: "synthetic-session=value" }),
    { "Mcp-Session-Id": "" },
    { "X-Qveris-Trial-Session-Token": "" },
    { "x-qveris-credential-context": "synthetic" },
  ]) {
    assert.throws(
      () => resolveAccessMode({ publicReadOnly: true, operation: "discover", headers }),
      (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT",
    );
    assert.equal(resolveAccessMode({ operation: "discover", headers }), "authenticated");
  }
  assert.throws(
    () => resolveAccessMode({ publicReadOnly: true, operation: "inspect", hasSessionProof: true }),
    (error) => error.code === "AUTH_PUBLIC_CREDENTIAL_CONFLICT",
  );
  assert.equal(
    resolveAccessMode({ publicReadOnly: true, operation: "discover", headers: { "Content-Type": "application/json" } }),
    "public-read-only",
  );
});

test("a public discovery context cannot match either authenticated cache context", () => {
  const publicContext = authorizationContextForPublicDiscovery();
  assert.notEqual(publicContext, authorizationContextForApiKey("synthetic-key"));
  assert.notEqual(publicContext, authorizationContextForOAuth({ authorization_context_id: "login-a" }));
  assert.equal(publicContext, authorizationContextForPublicDiscovery());
});
