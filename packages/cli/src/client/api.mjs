import { getSiteUrl, resolveBaseUrl } from "../config/endpoint.mjs";
import { CliError } from "../errors/handler.mjs";
import { getCredential, resolveCredentialProvider } from "./auth.mjs";
import {
  computeRetryDelayMs,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  parseRetryAfterMs,
  resolveMaxRetries,
  RETRYABLE_STATUS,
  sleep,
} from "./retry.mjs";

import { getOAuthSessionMetadata } from "../auth/storage.mjs";

export function resolveApiBaseUrl({ baseUrlFlag, preferOAuth = false } = {}) {
  if (preferOAuth && baseUrlFlag === undefined && typeof process.env.QVERIS_BASE_URL !== "string") {
    const session = getOAuthSessionMetadata();
    if (session?.api_base_url) {
      const { baseUrl } = resolveBaseUrl({ baseUrlFlag: session.api_base_url });
      if (new URL(baseUrl).origin !== session.issuer) {
        throw new CliError("API_ERROR", "Stored OAuth endpoint does not match its issuer");
      }
      return { baseUrl, source: "oauth session" };
    }
  }
  return resolveBaseUrl({ baseUrlFlag });
}

function getBaseUrl(baseUrlFlag, preferOAuth = false) {
  return resolveApiBaseUrl({ baseUrlFlag, preferOAuth }).baseUrl;
}

async function requestJson(
  path,
  {
    method = "POST",
    query = {},
    body,
    timeoutMs = 30000,
    credentialProvider,
    baseUrl,
    // Retry rate-limited (429) / transient (503) responses: honor Retry-After,
    // otherwise exponential backoff with jitter, bounded by maxRetries.
    maxRetries = resolveMaxRetries(process.env.QVERIS_MAX_RETRIES),
  },
) {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  let authRetried = false;
  for (let attempt = 0; ; attempt++) {
    // Credential acquisition is outside the API request timeout and happens
    // on every attempt so retries can refresh short-lived tokens.
    const credential = await getCredential(credentialProvider, {
      resource: baseUrl,
      scopes: [],
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryDelayMs;

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });

      if (response.status === 401 && !authRetried && typeof credentialProvider.refreshCredential === "function") {
        authRetried = true;
        await response.body?.cancel?.().catch(() => {});
        await credentialProvider.refreshCredential();
        continue;
      } else if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        retryDelayMs = computeRetryDelayMs({
          retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
          attempt,
          baseDelayMs: DEFAULT_BASE_DELAY_MS,
          maxDelayMs: DEFAULT_MAX_DELAY_MS,
        });
        // Discard the body so the connection is released before we retry.
        await response.body?.cancel?.().catch(() => {});
      } else if (!response.ok) {
        const status = response.status;
        const rawText = (await response.text()).slice(0, 8192);
        let errorDetail, jsonBody;
        try {
          jsonBody = JSON.parse(rawText);
          errorDetail = jsonBody.error_message || jsonBody.message || null;
        } catch {
          /* not JSON */
        }
        if (status === 401 && credentialProvider.authType === "oauth") {
          throw new CliError("AUTH_OAUTH_FAILED", errorDetail);
        }
        if (status === 403 && credentialProvider.authType === "oauth") {
          const err = new CliError("API_ERROR", `HTTP 403: ${errorDetail || rawText}`);
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        if (status === 401 || status === 403) {
          const err = new CliError("AUTH_INVALID_KEY", errorDetail);
          err.hint = `Check your key at ${getSiteUrl(baseUrl)}/account`;
          throw err;
        }
        if (status === 402) {
          const err = new CliError("CREDITS_INSUFFICIENT", errorDetail);
          err.hint = `Purchase credits at ${getSiteUrl(baseUrl)}/pricing`;
          throw err;
        }
        if (status === 429) throw new CliError("RATE_LIMITED", errorDetail);
        const err = new CliError("API_ERROR", `HTTP ${status}: ${errorDetail || rawText}`);
        err.status = status;
        if (jsonBody) err.responseData = jsonBody;
        throw err;
      } else {
        try {
          return await response.json();
        } catch {
          throw new CliError("API_ERROR", "Invalid JSON response from API");
        }
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      if (err.name === "AbortError") throw new CliError("NET_TIMEOUT");
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    // Only reached on the retry path (success returns, errors throw above).
    await sleep(retryDelayMs ?? 0);
  }
}

function unsupportedOptionalFields(error, allowedFields) {
  if (error?.status !== 422 || !error.responseData) return [];
  const body = error.responseData;
  const candidates = Array.isArray(body.detail) ? body.detail : Array.isArray(body.details) ? body.details : [];
  return [
    ...new Set(
      candidates
        .filter((item) => item?.type === "extra_forbidden" && Array.isArray(item.loc))
        .map((item) => item.loc.at(-1))
        .filter((field) => typeof field === "string" && allowedFields.has(field)),
    ),
  ];
}

async function requestWithOptionalFieldFallback(path, options, allowedFields) {
  try {
    return await requestJson(path, options);
  } catch (error) {
    const unsupported = unsupportedOptionalFields(error, allowedFields);
    if (unsupported.length === 0) throw error;
    const body = { ...options.body };
    for (const field of unsupported) delete body[field];
    return requestJson(path, { ...options, body });
  }
}

export function unwrapApiResponse(response) {
  if (
    response &&
    typeof response === "object" &&
    Object.prototype.hasOwnProperty.call(response, "status") &&
    Object.prototype.hasOwnProperty.call(response, "data")
  ) {
    if (response.status === "failure") {
      throw new CliError("API_ERROR", response.message || "API request failed");
    }
    return response.data;
  }
  return response;
}

export async function discoverTools({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  query,
  limit = 5,
  view,
  lang,
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestWithOptionalFieldFallback(
    "/search",
    {
      credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
      baseUrl,
      body: {
        query,
        limit,
        ...(view !== undefined && { view }),
        ...(lang !== undefined && { lang }),
      },
      timeoutMs,
    },
    new Set(["view", "lang"]),
  );
}

export async function inspectToolsByIds({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  toolIds,
  discoveryId,
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  const body = { tool_ids: toolIds };
  if (discoveryId) body.search_id = discoveryId;
  return requestJson("/tools/by-ids", {
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    body,
    timeoutMs,
  });
}

export async function callTool({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  toolId,
  discoveryId,
  parameters,
  maxResponseSize = 102400,
  respondWith,
  timeoutMs = 120000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestWithOptionalFieldFallback(
    "/tools/execute",
    {
      credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
      baseUrl,
      query: { tool_id: toolId },
      body: {
        search_id: discoveryId,
        parameters,
        max_response_size: maxResponseSize,
        ...(respondWith !== undefined && { respond_with: respondWith }),
      },
      timeoutMs,
    },
    new Set(["respond_with"]),
  );
}

export async function getCredits({ apiKey, credentialProvider, baseUrl: baseUrlFlag, timeoutMs = 30000 }) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestJson("/auth/credits", {
    method: "GET",
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    timeoutMs,
  });
}

export async function getUsageHistory({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  query = {},
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestJson("/auth/usage/history/v2", {
    method: "GET",
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query,
    timeoutMs,
  });
}

export async function getCreditsLedger({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  query = {},
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestJson("/auth/credits/ledger", {
    method: "GET",
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query,
    timeoutMs,
  });
}
