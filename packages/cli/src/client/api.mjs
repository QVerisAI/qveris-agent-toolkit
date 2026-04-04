import { resolve } from "../config/resolve.mjs";
import { CliError } from "../errors/handler.mjs";

function getBaseUrl(flagValue) {
  return resolve("base_url", flagValue).value;
}

async function requestJson(path, { method = "POST", query = {}, body, timeoutMs = 30000, apiKey, baseUrl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(baseUrl.replace(/\/$/, "") + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      const rawText = (await response.text()).slice(0, 8192);
      let errorDetail, jsonBody;
      try {
        jsonBody = JSON.parse(rawText);
        errorDetail = jsonBody.error_message || jsonBody.message || null;
      } catch { /* not JSON */ }
      // For known error codes, pass errorDetail only if it's a meaningful message
      // (not raw JSON); otherwise let the CliError template message apply
      if (status === 401 || status === 403) throw new CliError("AUTH_INVALID_KEY", errorDetail);
      if (status === 402) throw new CliError("CREDITS_INSUFFICIENT", errorDetail);
      if (status === 429) throw new CliError("RATE_LIMITED", errorDetail);
      const err = new CliError("API_ERROR", `HTTP ${status}: ${errorDetail || rawText}`);
      if (jsonBody) err.responseData = jsonBody;
      throw err;
    }

    try {
      return await response.json();
    } catch {
      throw new CliError("API_ERROR", "Invalid JSON response from API");
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err.name === "AbortError") throw new CliError("NET_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverTools({ apiKey, baseUrl: baseUrlFlag, query, limit = 5, timeoutMs = 30000 }) {
  const baseUrl = getBaseUrl(baseUrlFlag);
  return requestJson("/search", { apiKey, baseUrl, body: { query, limit }, timeoutMs });
}

export async function inspectToolsByIds({ apiKey, baseUrl: baseUrlFlag, toolIds, discoveryId, timeoutMs = 30000 }) {
  const baseUrl = getBaseUrl(baseUrlFlag);
  const body = { tool_ids: toolIds };
  if (discoveryId) body.search_id = discoveryId;
  return requestJson("/tools/by-ids", { apiKey, baseUrl, body, timeoutMs });
}

export async function callTool({
  apiKey,
  baseUrl: baseUrlFlag,
  toolId,
  discoveryId,
  parameters,
  maxResponseSize = 102400,
  timeoutMs = 120000,
}) {
  const baseUrl = getBaseUrl(baseUrlFlag);
  return requestJson("/tools/execute", {
    apiKey,
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

