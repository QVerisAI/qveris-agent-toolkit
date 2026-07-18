import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "../errors/handler.mjs";
import { getOAuthSessionMetadata, loadOAuthSessionSecret, saveOAuthSession } from "./storage.mjs";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const OAUTH_CLIENT_ID = "qveris-cli";
export const DEFAULT_OAUTH_SCOPES = "openid offline_access tools.search tools.inspect tools.execute";
let sharedRefreshPromise = null;

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

async function jsonResponse(response, label) {
  let payload;
  try {
    payload = await response.json();
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
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new CliError("API_ERROR", `OAuth ${label} must use HTTPS`);
  }
  if (url.username || url.password || url.hash) {
    throw new CliError("API_ERROR", `OAuth discovery has an unsafe ${label}`);
  }
  return url.toString();
}

function validateIssuerEndpoint(metadata, key) {
  const endpoint = validateEndpoint(metadata[key], key);
  if (new URL(endpoint).origin !== metadata.issuer) {
    throw new CliError("API_ERROR", `OAuth ${key} does not match the stored issuer`);
  }
  return endpoint;
}

export async function discoverAuthorizationServer(issuer, fetchImpl = fetch) {
  const normalizedIssuer = new URL(issuer).origin;
  const response = await fetchImpl(`${normalizedIssuer}/.well-known/oauth-authorization-server`, {
    headers: { Accept: "application/json" },
  });
  const metadata = await jsonResponse(response, "OAuth discovery");
  if (!response.ok) throw oauthError(metadata.error || "discovery_failed", metadata.error_description);
  if (metadata.issuer !== normalizedIssuer) {
    throw new CliError("API_ERROR", "OAuth discovery issuer does not match the requested endpoint");
  }
  if (!metadata.grant_types_supported?.includes(DEVICE_CODE_GRANT)) {
    throw new CliError("API_ERROR", "This endpoint does not advertise Device Authorization Grant");
  }
  if (!metadata.token_endpoint_auth_methods_supported?.includes("none")) {
    throw new CliError("API_ERROR", "This endpoint does not support the public QVeris CLI client");
  }
  return {
    issuer: normalizedIssuer,
    device_authorization_endpoint: validateEndpoint(
      metadata.device_authorization_endpoint,
      "device_authorization_endpoint",
    ),
    token_endpoint: validateEndpoint(metadata.token_endpoint, "token_endpoint"),
    revocation_endpoint: validateEndpoint(metadata.revocation_endpoint, "revocation_endpoint"),
    scopes_supported: Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported : [],
  };
}

async function postForm(url, form, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
  });
  return { response, payload: await jsonResponse(response, "OAuth endpoint") };
}

export async function startDeviceAuthorization(metadata, { scope, resource }, fetchImpl = fetch) {
  const { response, payload } = await postForm(
    metadata.device_authorization_endpoint,
    { client_id: OAUTH_CLIENT_ID, scope, resource },
    fetchImpl,
  );
  if (!response.ok) throw oauthError(payload.error || "authorization_failed", payload.error_description);
  for (const field of ["device_code", "user_code", "verification_uri"]) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw new CliError("API_ERROR", `Device Authorization response is missing ${field}`);
    }
  }
  const verificationUri = validateEndpoint(payload.verification_uri, "verification_uri");
  const verificationUriComplete = payload.verification_uri_complete
    ? validateEndpoint(payload.verification_uri_complete, "verification_uri_complete")
    : undefined;
  return {
    ...payload,
    verification_uri: verificationUri,
    ...(verificationUriComplete ? { verification_uri_complete: verificationUriComplete } : {}),
    expires_in: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : 600,
    interval: Number.isFinite(Number(payload.interval)) ? Math.max(1, Number(payload.interval)) : 5,
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
    await sleep(intervalMs);
    const { response, payload } = await postForm(
      metadata.token_endpoint,
      {
        grant_type: DEVICE_CODE_GRANT,
        client_id: OAUTH_CLIENT_ID,
        device_code: authorization.device_code,
      },
      fetchImpl,
    );
    onPoll?.(payload.error || "approved");
    if (response.ok) return validateTokenResponse(payload);
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

function validateTokenResponse(payload) {
  if (payload.token_type?.toLowerCase() !== "bearer" || typeof payload.access_token !== "string") {
    throw new CliError("API_ERROR", "Token endpoint returned an invalid access token response");
  }
  return payload;
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
  if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
    throw new CliError("API_ERROR", "Token endpoint did not rotate the refresh token");
  }
  const replacement = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
  const updated = {
    ...metadata,
    expires_at: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000,
  };
  await saveOAuthSession(updated, replacement);
  return { metadata: updated, secret: replacement };
}

export async function revokeOAuthToken(metadata, token, hint, fetchImpl = fetch) {
  if (!token) return;
  const revocationEndpoint = validateIssuerEndpoint(metadata, "revocation_endpoint");
  const response = await fetchImpl(revocationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, token, token_type_hint: hint }),
  });
  if (response.ok) return;
  const payload = await jsonResponse(response, "OAuth revocation endpoint");
  throw oauthError(payload.error || "revoke_failed", payload.error_description);
}

export async function revokeOAuthSession(metadata, secret, fetchImpl = fetch) {
  let firstError = null;
  for (const [token, hint] of [
    [secret.refresh_token, "refresh_token"],
    [secret.access_token, "access_token"],
  ]) {
    try {
      await revokeOAuthToken(metadata, token, hint, fetchImpl);
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}

export function createStoredOAuthCredentialProvider({ fetchImpl = fetch } = {}) {
  async function refresh() {
    if (!sharedRefreshPromise) {
      sharedRefreshPromise = (async () => {
        const metadata = getOAuthSessionMetadata();
        const secret = await loadOAuthSessionSecret(metadata);
        if (!metadata || !secret) {
          throw oauthError("invalid_grant", "OAuth session is unavailable; run qveris auth login again");
        }
        return refreshOAuthSession(metadata, secret, fetchImpl);
      })().finally(() => {
        sharedRefreshPromise = null;
      });
    }
    return sharedRefreshPromise;
  }
  return {
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
        ({ secret } = await refresh());
      }
      return secret.access_token;
    },
    async refreshCredential() {
      const result = await refresh();
      return result.secret.access_token;
    },
  };
}
