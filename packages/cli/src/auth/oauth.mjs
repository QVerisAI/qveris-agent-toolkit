import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "../errors/handler.mjs";
import { getOAuthSessionMetadata, loadOAuthSessionSecret, saveOAuthSession, withOAuthRefreshLock } from "./storage.mjs";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const OAUTH_CLIENT_ID = "qveris-cli";
export const DEFAULT_OAUTH_SCOPES = "openid offline_access tools.search tools.inspect tools.execute";
const OAUTH_REQUEST_TIMEOUT_MS = 30000;
const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024;
const MAX_OAUTH_TOKEN_LENGTH = 16384;
const MAX_DEVICE_TIMER_SECONDS = Math.floor(0x7fffffff / 1000);
const MAX_TOKEN_LIFETIME_SECONDS = Math.floor((Number.MAX_SAFE_INTEGER - Date.now()) / 1000);
let sharedRefreshPromise = null;

function isSameOAuthSession(left, right) {
  return (
    left?.issuer === right?.issuer &&
    left?.api_base_url === right?.api_base_url &&
    left?.token_endpoint === right?.token_endpoint &&
    left?.revocation_endpoint === right?.revocation_endpoint
  );
}

function oauthError(code) {
  const messages = {
    access_denied: "Device authorization was denied",
    expired_token: "Device authorization or OAuth session expired",
    invalid_grant: "OAuth session is invalid or no longer active",
    invalid_client: "The public QVeris CLI client is unavailable",
  };
  const err = new CliError("AUTH_OAUTH_FAILED", messages[code] || `OAuth request failed (${code})`);
  err.oauthCode = code;
  return err;
}

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

async function jsonResponse(response, label) {
  let raw = "";
  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_OAUTH_RESPONSE_BYTES) {
            await reader.cancel();
            throw new CliError("API_ERROR", `${label} exceeded the maximum response size`);
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error?.name === "AbortError") throw error;
    throw new CliError("API_ERROR", `${label} could not be read`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new CliError("API_ERROR", `${label} returned invalid JSON`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError("API_ERROR", `${label} returned an invalid response`);
  }
  return payload;
}

function validateEndpoint(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("API_ERROR", `OAuth discovery has an invalid ${label}`);
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new CliError("API_ERROR", `OAuth ${label} must use HTTPS`);
  }
  if (url.username || url.password || url.hash) {
    throw new CliError("API_ERROR", `OAuth discovery has an unsafe ${label}`);
  }
  return url.toString();
}

export function validateOAuthScopes(metadata, scope) {
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  if (!requestedScopes.includes("offline_access")) {
    throw new CliError("API_ERROR", "OAuth scopes must include offline_access for a persistent CLI session");
  }
  const unsupported = requestedScopes.filter((item) => !metadata.scopes_supported.includes(item));
  if (unsupported.length) {
    throw new CliError("API_ERROR", `OAuth scopes are not supported: ${unsupported.join(", ")}`);
  }
  return requestedScopes;
}

function validateIssuerEndpoint(metadata, key) {
  const endpoint = validateEndpoint(metadata[key], key);
  if (new URL(endpoint).origin !== metadata.issuer) {
    throw new CliError("API_ERROR", `OAuth ${key} does not match the stored issuer`);
  }
  return endpoint;
}

function positiveNumber(value, label, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > maximum) {
    throw new CliError("API_ERROR", `OAuth response has an invalid ${label}`);
  }
  return normalized;
}

async function timedFetch(
  fetchImpl,
  url,
  options = {},
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
  consumeResponse = (response) => response,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consumeResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") throw new CliError("NET_TIMEOUT", "OAuth request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverAuthorizationServer(issuer, fetchImpl = fetch) {
  const normalizedIssuer = new URL(validateEndpoint(issuer, "issuer")).origin;
  const { response, payload: metadata } = await timedFetch(
    fetchImpl,
    `${normalizedIssuer}/.well-known/oauth-authorization-server`,
    {
      headers: { Accept: "application/json" },
      redirect: "error",
    },
    OAUTH_REQUEST_TIMEOUT_MS,
    async (response) => ({ response, payload: await jsonResponse(response, "OAuth discovery") }),
  );
  if (!response.ok) throw oauthError(metadata.error || "discovery_failed", metadata.error_description);
  if (metadata.issuer !== normalizedIssuer) {
    throw new CliError("API_ERROR", "OAuth discovery issuer does not match the requested endpoint");
  }
  if (!metadata.grant_types_supported?.includes(DEVICE_CODE_GRANT)) {
    throw new CliError("API_ERROR", "This endpoint does not advertise Device Authorization Grant");
  }
  if (!metadata.grant_types_supported.includes("refresh_token")) {
    throw new CliError("API_ERROR", "This endpoint does not advertise Refresh Token Grant");
  }
  if (!metadata.token_endpoint_auth_methods_supported?.includes("none")) {
    throw new CliError("API_ERROR", "This endpoint does not support the public QVeris CLI client");
  }
  const result = {
    issuer: normalizedIssuer,
    device_authorization_endpoint: validateEndpoint(
      metadata.device_authorization_endpoint,
      "device_authorization_endpoint",
    ),
    token_endpoint: validateEndpoint(metadata.token_endpoint, "token_endpoint"),
    revocation_endpoint: validateEndpoint(metadata.revocation_endpoint, "revocation_endpoint"),
    scopes_supported: Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported : [],
  };
  for (const key of ["device_authorization_endpoint", "token_endpoint", "revocation_endpoint"]) {
    validateIssuerEndpoint(result, key);
  }
  return result;
}

async function postForm(url, form, fetchImpl = fetch, timeoutMs = OAUTH_REQUEST_TIMEOUT_MS) {
  return timedFetch(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form),
      redirect: "error",
    },
    timeoutMs,
    async (response) => ({ response, payload: await jsonResponse(response, "OAuth endpoint") }),
  );
}

export async function startDeviceAuthorization(metadata, { scope, resource }, fetchImpl = fetch) {
  const normalizedResource = validateEndpoint(resource, "resource");
  const { response, payload } = await postForm(
    metadata.device_authorization_endpoint,
    { client_id: OAUTH_CLIENT_ID, scope, resource: normalizedResource },
    fetchImpl,
  );
  if (!response.ok) throw oauthError(payload.error || "authorization_failed", payload.error_description);
  for (const field of ["device_code", "user_code", "verification_uri"]) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw new CliError("API_ERROR", `Device Authorization response is missing ${field}`);
    }
  }
  if (payload.user_code.length > 256 || hasControlCharacters(payload.user_code)) {
    throw new CliError("API_ERROR", "Device Authorization response has an invalid user_code");
  }
  const verificationUri = validateEndpoint(payload.verification_uri, "verification_uri");
  const verificationUriComplete = payload.verification_uri_complete
    ? validateEndpoint(payload.verification_uri_complete, "verification_uri_complete")
    : undefined;
  if (verificationUriComplete && new URL(verificationUriComplete).origin !== new URL(verificationUri).origin) {
    throw new CliError("API_ERROR", "OAuth verification_uri_complete does not match verification_uri");
  }
  return {
    ...payload,
    verification_uri: verificationUri,
    ...(verificationUriComplete ? { verification_uri_complete: verificationUriComplete } : {}),
    expires_in: positiveNumber(payload.expires_in, "expires_in", undefined, MAX_DEVICE_TIMER_SECONDS),
    interval: positiveNumber(payload.interval, "interval", 5, MAX_DEVICE_TIMER_SECONDS),
  };
}

export async function pollDeviceToken(
  metadata,
  authorization,
  { fetchImpl = fetch, sleep = (ms) => delay(ms), now = () => Date.now(), onPoll } = {},
) {
  const deadline = now() + authorization.expires_in * 1000;
  let intervalMs = authorization.interval * 1000;
  while (now() < deadline) {
    await sleep(Math.min(intervalMs, deadline - now()));
    if (now() >= deadline) break;
    let tokenResult;
    const remainingMs = deadline - now();
    const boundedByAuthorizationDeadline = remainingMs <= OAUTH_REQUEST_TIMEOUT_MS;
    try {
      tokenResult = await postForm(
        metadata.token_endpoint,
        {
          grant_type: DEVICE_CODE_GRANT,
          client_id: OAUTH_CLIENT_ID,
          device_code: authorization.device_code,
        },
        fetchImpl,
        Math.max(1, Math.min(OAUTH_REQUEST_TIMEOUT_MS, remainingMs)),
      );
    } catch (error) {
      if (error?.code === "NET_TIMEOUT" && boundedByAuthorizationDeadline) break;
      throw error;
    }
    const { response, payload } = tokenResult;
    onPoll?.(payload.error || "approved");
    if (response.ok) return validateTokenResponse(payload, { requireRefreshToken: true });
    if (payload.error === "authorization_pending") continue;
    if (payload.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (["access_denied", "expired_token", "invalid_grant"].includes(payload.error)) {
      throw oauthError(payload.error, payload.error_description);
    }
    throw oauthError(payload.error || "token_error", payload.error_description);
  }
  throw oauthError("expired_token", "Device authorization expired before it was approved");
}

function validateTokenResponse(payload, { requireRefreshToken = false } = {}) {
  const validToken = (value, { allowInternalSpaces = false } = {}) =>
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= MAX_OAUTH_TOKEN_LENGTH &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= (allowInternalSpaces ? 0x20 : 0x21) && codePoint <= 0x7e;
    });
  if (
    typeof payload.token_type !== "string" ||
    payload.token_type.toLowerCase() !== "bearer" ||
    !validToken(payload.access_token)
  ) {
    throw new CliError("API_ERROR", "Token endpoint returned an invalid access token response");
  }
  if (payload.refresh_token === undefined && requireRefreshToken) {
    throw new CliError("API_ERROR", "Token endpoint did not return the required refresh token");
  }
  if (payload.refresh_token !== undefined && !validToken(payload.refresh_token, { allowInternalSpaces: true })) {
    throw new CliError("API_ERROR", "Token endpoint returned an invalid refresh token");
  }
  if (
    payload.scope !== undefined &&
    (typeof payload.scope !== "string" || !payload.scope.trim() || hasControlCharacters(payload.scope))
  ) {
    throw new CliError("API_ERROR", "Token endpoint returned an invalid scope");
  }
  const normalizedResource =
    payload.resource === undefined ? undefined : validateEndpoint(payload.resource, "resource");
  return {
    ...payload,
    ...(normalizedResource ? { resource: normalizedResource } : {}),
    expires_in: positiveNumber(payload.expires_in, "expires_in", undefined, MAX_TOKEN_LIFETIME_SECONDS),
  };
}

export function validateOAuthTokenBinding(tokens, { resource, scope }) {
  const expectedResource = validateEndpoint(resource, "resource");
  if (tokens.resource && tokens.resource !== expectedResource) {
    throw new CliError("API_ERROR", "Token endpoint returned credentials for an unexpected resource");
  }
  const requestedScopes = String(scope || "")
    .split(/\s+/)
    .filter(Boolean);
  const grantedScopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : requestedScopes;
  const requested = new Set(requestedScopes);
  if (grantedScopes.some((item) => !requested.has(item))) {
    throw new CliError("API_ERROR", "Token endpoint returned credentials with an unexpected scope");
  }
  return {
    resource: tokens.resource || expectedResource,
    scope: grantedScopes.join(" "),
  };
}

export async function refreshOAuthSession(metadata, secret, fetchImpl = fetch) {
  if (typeof secret.refresh_token !== "string" || !secret.refresh_token) {
    throw oauthError("invalid_grant", "OAuth session cannot be refreshed; run qveris auth login again");
  }
  const tokenEndpoint = validateIssuerEndpoint(metadata, "token_endpoint");
  const { response, payload } = await postForm(
    tokenEndpoint,
    { grant_type: "refresh_token", client_id: OAUTH_CLIENT_ID, refresh_token: secret.refresh_token },
    fetchImpl,
  );
  if (!response.ok) throw oauthError(payload.error || "refresh_failed", payload.error_description);
  const tokens = validateTokenResponse(payload);
  // QVeris advertises refresh-token rotation as part of its public OAuth contract.
  // Rejecting a non-rotating response prevents reuse of a superseded credential.
  if (
    typeof tokens.refresh_token !== "string" ||
    !tokens.refresh_token.trim() ||
    tokens.refresh_token === secret.refresh_token
  ) {
    throw new CliError("API_ERROR", "Token endpoint did not rotate the refresh token");
  }
  const replacement = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
  let binding;
  try {
    binding = validateOAuthTokenBinding(tokens, metadata);
  } catch (error) {
    try {
      await revokeOAuthSession(metadata, replacement, fetchImpl);
    } catch {
      // Preserve the binding error as the actionable failure.
    }
    throw error;
  }
  const updated = {
    ...metadata,
    ...binding,
    expires_at: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000,
  };
  let persisted;
  try {
    persisted = await saveOAuthSession(updated, replacement);
  } catch (error) {
    try {
      await revokeOAuthSession(updated, replacement, fetchImpl);
    } catch {
      // Preserve the local persistence error as the actionable failure.
    }
    throw error;
  }
  if (["keyring", "config"].includes(metadata.storage) && !persisted) {
    throw new CliError("API_ERROR", "Rotated OAuth credentials could not be persisted; run qveris auth login again");
  }
  return { metadata: updated, secret: replacement };
}

export async function revokeOAuthToken(metadata, token, hint, fetchImpl = fetch) {
  if (!token) return;
  const revocationEndpoint = validateIssuerEndpoint(metadata, "revocation_endpoint");
  const { response, payload } = await timedFetch(
    fetchImpl,
    revocationEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, token, token_type_hint: hint }),
      redirect: "error",
    },
    OAUTH_REQUEST_TIMEOUT_MS,
    async (response) => ({
      response,
      payload: response.ok ? null : await jsonResponse(response, "OAuth revocation endpoint"),
    }),
  );
  if (response.ok) return;
  throw oauthError(payload.error || "revoke_failed", payload.error_description);
}

export async function revokeOAuthSession(metadata, secret, fetchImpl = fetch) {
  const results = await Promise.allSettled([
    revokeOAuthToken(metadata, secret.refresh_token, "refresh_token", fetchImpl),
    revokeOAuthToken(metadata, secret.access_token, "access_token", fetchImpl),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

export function createStoredOAuthCredentialProvider({ fetchImpl = fetch } = {}) {
  async function refresh() {
    if (!sharedRefreshPromise) {
      sharedRefreshPromise = (async () => {
        const initialMetadata = getOAuthSessionMetadata();
        const initialSecret = await loadOAuthSessionSecret(initialMetadata);
        if (!initialMetadata || !initialSecret) {
          throw oauthError("invalid_grant", "OAuth session is unavailable; run qveris auth login again");
        }
        if (initialMetadata.storage === "session") {
          return refreshOAuthSession(initialMetadata, initialSecret, fetchImpl);
        }
        return withOAuthRefreshLock(async () => {
          const metadata = getOAuthSessionMetadata({ fresh: true });
          const secret = await loadOAuthSessionSecret(metadata, { fresh: true });
          if (!metadata || !secret) {
            throw oauthError("invalid_grant", "OAuth session is unavailable; run qveris auth login again");
          }
          if (!isSameOAuthSession(metadata, initialMetadata)) {
            throw new CliError(
              "API_ERROR",
              "OAuth session changed while credentials were being refreshed; retry the command",
            );
          }
          if (
            secret.access_token !== initialSecret.access_token ||
            secret.refresh_token !== initialSecret.refresh_token
          ) {
            return { metadata, secret };
          }
          return refreshOAuthSession(metadata, secret, fetchImpl);
        });
      })().finally(() => {
        sharedRefreshPromise = null;
      });
    }
    return sharedRefreshPromise;
  }
  return {
    authType: "oauth",
    async getCredential(context) {
      const metadata = getOAuthSessionMetadata();
      let secret = await loadOAuthSessionSecret(metadata);
      if (!metadata || !secret) {
        throw oauthError("invalid_grant", "OAuth session is unavailable; run qveris auth login again");
      }
      if (new URL(context.resource).origin !== metadata.issuer) {
        throw new CliError("API_ERROR", "OAuth session does not match the selected API endpoint");
      }
      if (Date.now() >= Number(metadata.expires_at || 0) - 60000) {
        const refreshed = await refresh();
        if (!isSameOAuthSession(refreshed.metadata, metadata)) {
          throw new CliError(
            "API_ERROR",
            "OAuth session changed while credentials were being refreshed; retry the command",
          );
        }
        ({ secret } = refreshed);
      }
      return secret.access_token;
    },
    async refreshCredential() {
      const result = await refresh();
      return result.secret.access_token;
    },
  };
}
