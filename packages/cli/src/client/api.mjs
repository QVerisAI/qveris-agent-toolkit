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

function getBaseUrl(baseUrlFlag) {
  return resolveBaseUrl({ baseUrlFlag }).baseUrl;
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
      });

      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
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
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag);
  return requestJson("/search", {
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    body: { query, limit },
    timeoutMs,
  });
}

export async function inspectToolsByIds({
  apiKey,
  credentialProvider,
  baseUrl: baseUrlFlag,
  toolIds,
  discoveryId,
  timeoutMs = 30000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag);
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
  timeoutMs = 120000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag);
  return requestJson("/tools/execute", {
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query: { tool_id: toolId },
    body: {
      search_id: discoveryId,
      parameters,
      max_response_size: maxResponseSize,
    },
    timeoutMs,
  });
}

export async function getCredits({ apiKey, credentialProvider, baseUrl: baseUrlFlag, timeoutMs = 30000 }) {
  const baseUrl = getBaseUrl(baseUrlFlag);
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
  const baseUrl = getBaseUrl(baseUrlFlag);
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
  const baseUrl = getBaseUrl(baseUrlFlag);
  return requestJson("/auth/credits/ledger", {
    method: "GET",
    credentialProvider: resolveCredentialProvider({ apiKey, credentialProvider }),
    baseUrl,
    query,
    timeoutMs,
  });
}
