import { getTrialRegistration, hasStoredTrialCredential } from "../auth/trial-storage.mjs";
import { randomUUID } from "node:crypto";
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
import { normalizeCreditBalanceResponse } from "./credit-balance.mjs";
import { resolveAccessMode } from "./access-mode.mjs";
import { isPublicDiscoveryContext, validatePublicBody, validatePublicResponse } from "./public-discovery.mjs";

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
    if (hasStoredTrialCredential()) return { baseUrl: getTrialRegistration().base_url, source: "trial registration" };
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
    allowAuthReplay = true,
    requestHeaders = {},
    publicReadOnly = false,
  },
) {
  resolveAccessMode({
    publicReadOnly,
    hasCredentials: credentialProvider !== undefined,
    headers: requestHeaders,
    operation: path === "/search" ? "discover" : path === "/tools/by-ids" ? "inspect" : path,
  });
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
    const credential = publicReadOnly
      ? undefined
      : await getCredential(credentialProvider, {
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
          ...(publicReadOnly
            ? { "X-Qveris-Access-Mode": "public-readonly" }
            : { Authorization: `Bearer ${credential}` }),
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
        ...(publicReadOnly ? { credentials: "omit", cache: "no-store" } : {}),
      });

      if (
        allowAuthReplay &&
        response.status === 401 &&
        !authRetried &&
        typeof credentialProvider?.refreshCredential === "function"
      ) {
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
        if (status === 401 && publicReadOnly) {
          const err = new CliError("PUBLIC_DISCOVERY_UNAVAILABLE");
          err.status = status;
          throw err;
        }
        if (status === 401 && credentialProvider?.authType === "oauth") {
          const err = new CliError("AUTH_OAUTH_FAILED", errorDetail);
          err.status = status;
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        if (status === 403) {
          const err = new CliError("PERMISSION_DENIED", errorDetail || "The current credential lacks permission");
          err.hint = `Confirm access for the configured account at ${getSiteUrl(baseUrl)}/account`;
          err.status = status;
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        if (status === 401) {
          const err = new CliError("AUTH_INVALID_KEY", errorDetail);
          err.hint = `Check your key at ${getSiteUrl(baseUrl)}/account`;
          err.status = status;
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        if (status === 402) {
          const err = new CliError("CREDITS_INSUFFICIENT", errorDetail);
          err.hint = `Purchase credits at ${getSiteUrl(baseUrl)}/pricing`;
          err.status = status;
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        if (status === 429) {
          const err = new CliError("RATE_LIMITED", errorDetail);
          err.status = status;
          if (jsonBody) err.responseData = jsonBody;
          throw err;
        }
        const err = new CliError("API_ERROR", `HTTP ${status}: ${errorDetail || rawText}`);
        err.status = status;
        if (jsonBody) err.responseData = jsonBody;
        throw err;
      } else {
        try {
          return normalizeCreditBalanceResponse(await response.json());
        } catch {
          const error = new CliError("API_ERROR", "Invalid JSON response from API");
          error.status = response.status;
          throw error;
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
  publicReadOnly = false,
}) {
  resolveAccessMode({
    publicReadOnly,
    hasCredentials: apiKey !== undefined || credentialProvider !== undefined,
    operation: "discover",
  });
  const baseUrl = getBaseUrl(baseUrlFlag, !publicReadOnly && apiKey === undefined && credentialProvider === undefined);
  const body = { query, limit, ...(view !== undefined && { view }), ...(lang !== undefined && { lang }) };
  if (publicReadOnly)
    return validatePublicResponse(
      await requestJson("/search", {
        publicReadOnly,
        baseUrl,
        body: validatePublicBody(body, "discover"),
        timeoutMs,
      }),
    );
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
  publicReadOnly = false,
}) {
  resolveAccessMode({
    publicReadOnly,
    hasCredentials: apiKey !== undefined || credentialProvider !== undefined,
    operation: "inspect",
  });
  const baseUrl = getBaseUrl(baseUrlFlag, !publicReadOnly && apiKey === undefined && credentialProvider === undefined);
  const body = { tool_ids: toolIds };
  if (discoveryId) body.search_id = discoveryId;
  if (publicReadOnly)
    return validatePublicResponse(
      await requestJson("/tools/by-ids", {
        publicReadOnly,
        baseUrl,
        body: validatePublicBody(body, "inspect"),
        timeoutMs,
      }),
    );
  if (isPublicDiscoveryContext(discoveryId)) throw new CliError("AUTH_PUBLIC_CONTEXT");
  return requestJson("/tools/by-ids", {
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    body,
    timeoutMs,
  });
}

export async function probeTool({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  toolId,
  parameters = {},
  checks = ["schema"],
  liveBudget = "none",
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestJson("/tools/probe", {
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query: { tool_id: toolId },
    body: { parameters, checks, live_budget: liveBudget },
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
  model,
  requireZeroQuote = false,
  idempotencyKey = randomUUID(),
  timeoutMs = 120000,
}) {
  if (isPublicDiscoveryContext(discoveryId)) throw new CliError("AUTH_PUBLIC_CONTEXT");
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim())) {
    throw new CliError("API_ERROR", "--idempotency-key must be non-empty");
  }
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  const credential = resolveCredentialProvider({ apiKey, credentialProvider });
  const recoveryRequest = () =>
    getExecutionByIdempotencyKey({
      apiKey,
      credentialProvider,
      baseUrl,
      key: idempotencyKey,
      timeoutMs: Math.min(timeoutMs, 30000),
      maxRetries: 0,
    });
  try {
    const response = await requestJson("/tools/execute", {
      credentialProvider: credential,
      baseUrl,
      query: { tool_id: toolId },
      body: {
        search_id: discoveryId,
        parameters,
        max_response_size: maxResponseSize,
        ...(respondWith !== undefined && { respond_with: respondWith }),
        ...(model !== undefined && { model }),
        ...(requireZeroQuote && { require_zero_quote: true }),
      },
      requestHeaders: { "Idempotency-Key": idempotencyKey },
      timeoutMs,
      maxRetries: 0,
      allowAuthReplay: false,
    });
    if (!executionIdFrom(response)) {
      let recovery;
      try {
        recovery = unwrapApiResponse(await recoveryRequest());
        if (
          recovery?.status === "completed" &&
          recovery.response &&
          typeof recovery.response === "object" &&
          typeof recovery.response.success === "boolean" &&
          executionIdFrom(recovery.response)
        ) {
          return normalizeCreditBalanceResponse(recovery.response);
        }
      } catch {
        // The key is returned to the caller for a later explicit lookup.
      }
      return {
        ...(response && typeof response === "object" && !Array.isArray(response)
          ? response
          : { response_data: response }),
        idempotency_key: idempotencyKey,
        ...(recovery && typeof recovery === "object" && { recovery }),
      };
    }
    return response;
  } catch (error) {
    const uncertain = isUncertainCallError(error);
    if (error && typeof error === "object" && (uncertain || error.status === 200 || error.status === 409)) {
      error.idempotencyKey = idempotencyKey;
    }
    if (!uncertain) throw error;
    try {
      const recovery = unwrapApiResponse(await recoveryRequest());
      if (
        recovery?.status === "completed" &&
        recovery.response &&
        typeof recovery.response === "object" &&
        !Array.isArray(recovery.response) &&
        typeof recovery.response.success === "boolean" &&
        executionIdFrom(recovery.response)
      ) {
        return normalizeCreditBalanceResponse(recovery.response);
      }
      if (recovery && typeof recovery === "object") error.recovery = recovery;
    } catch {
      // The recovery request is read-only. Never issue a second execute POST.
    }
    throw error;
  }
}

export async function getExecutionByIdempotencyKey({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  key,
  timeoutMs = 30000,
  maxRetries,
}) {
  const baseUrl = typeof baseUrlFlag === "string" ? baseUrlFlag : getBaseUrl(baseUrlFlag, false);
  return requestJson("/tools/executions/by-idempotency-key", {
    method: "GET",
    query: { key },
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    timeoutMs,
    maxRetries,
  });
}

function isUncertainCallError(error) {
  return (
    error?.status === 0 ||
    error?.status === 200 ||
    error?.status === 408 ||
    error?.status >= 500 ||
    error?.code === "NET_TIMEOUT" ||
    error instanceof TypeError
  );
}

function executionIdFrom(value) {
  if (typeof value?.execution_id === "string" && value.execution_id.trim()) return value.execution_id;
  if (typeof value?.data?.execution_id === "string" && value.data.execution_id.trim()) return value.data.execution_id;
  return null;
}

export async function reconcileToolExecution({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  idempotencyKey,
  timeoutMs = 30000,
}) {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new CliError("API_ERROR", "--idempotency-key must be non-empty");
  }
  const baseUrl = getBaseUrl(baseUrlFlag, apiKey === undefined && credentialProvider === undefined);
  return requestJson("/tools/executions/by-idempotency-key", {
    method: "GET",
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query: { key: idempotencyKey },
    timeoutMs,
    // A lookup is read-only. It may use normal transient read retries.
  });
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
