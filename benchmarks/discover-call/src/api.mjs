const DEFAULT_BASE_URL = 'https://qveris.ai/api/v1';
const RETRYABLE_STATUS = new Set([429, 503]);

export function createApiClient({
  apiKey,
  baseUrl = process.env.QVERIS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 120_000,
  maxRetries = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || /[\r\n]/.test(key)) throw new Error('QVERIS_API_KEY is required');
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error('maxRetries must be an integer from 0 to 10');
  }

  async function request(path, body) {
    let response;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchImpl(`${resolvedBaseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        if (attempt >= maxRetries) throw apiError('Network request failed');
        await sleep(retryDelayMs(null, attempt));
        continue;
      } finally {
        clearTimeout(timeout);
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) break;
      await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
      await sleep(retryDelayMs(response.headers.get('retry-after'), attempt));
    }
    if (!response.ok) {
      await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
      throw apiError(`HTTP ${response.status}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw apiError('Invalid API response');
    }
    if (
      payload &&
      typeof payload === 'object' &&
      'data' in payload &&
      ('status' in payload || 'status_code' in payload || 'message' in payload)
    ) {
      const status = payload.status ?? payload.status_code;
      if (
        (typeof status === 'string' && ['failure', 'failed', 'error'].includes(status.toLowerCase())) ||
        (typeof status === 'number' && status >= 400)
      ) {
        throw apiError('API returned a failure envelope');
      }
      return payload.data;
    }
    return payload;
  }

  return {
    baseUrl: resolvedBaseUrl,
    discover: ({ query, limit }) => request('/search', { query, limit }),
    inspect: ({ toolIds, discoveryId }) =>
      request('/tools/by-ids', {
        tool_ids: toolIds,
        ...(discoveryId ? { search_id: discoveryId } : {}),
      }),
    call: ({ toolId, discoveryId, parameters }) =>
      request(`/tools/execute?tool_id=${encodeURIComponent(toolId)}`, {
        parameters,
        search_id: discoveryId ?? null,
      }),
  };
}

function retryDelayMs(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  return Math.min(500 * 2 ** attempt, 60_000);
}

export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\s\\]/.test(value)) {
    throw new Error('QVERIS_BASE_URL must be a valid HTTP(S) URL');
  }
  const candidate = value.trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('QVERIS_BASE_URL must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('QVERIS_BASE_URL must be a valid HTTP(S) URL without credentials');
  }
  if (candidate.includes('?') || candidate.includes('#')) {
    throw new Error('QVERIS_BASE_URL must not contain a query or fragment');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function apiError(message) {
  const error = new Error(message);
  error.benchmarkStage = 'api';
  return error;
}
