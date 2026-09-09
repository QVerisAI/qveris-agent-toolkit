import { createHash, randomUUID } from "node:crypto";

const CONTEXT_PREFIX = "v1";

function digest(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validStoredId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

export function createOAuthAuthorizationContextId() {
  return randomUUID();
}

export function deriveLegacyOAuthAuthorizationContextId(metadata, secret) {
  if (typeof metadata?.issuer !== "string" || typeof secret?.refresh_token !== "string") return null;
  if (!metadata.issuer || !secret.refresh_token) return null;
  return digest([metadata.issuer, secret.refresh_token]);
}

export function authorizationContextForApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) return null;
  return `${CONTEXT_PREFIX}:api-key:${digest([apiKey])}`;
}

export function authorizationContextIdForOAuth(metadata, secret) {
  return validStoredId(metadata?.authorization_context_id)
    ? metadata.authorization_context_id
    : deriveLegacyOAuthAuthorizationContextId(metadata, secret);
}

export function authorizationContextForOAuth(metadata, secret) {
  const storedId = authorizationContextIdForOAuth(metadata, secret);
  return storedId ? `${CONTEXT_PREFIX}:oauth:${storedId}` : null;
}
