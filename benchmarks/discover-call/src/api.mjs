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
  const observedApiRevisions = new Set();
  const observedCatalogRevisions = new Set();
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error('maxRetries must be an integer from 0 to 10');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer');
  }

  async function request(path, body) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let retryDelay;
      try {
        const response = await fetchImpl(`${resolvedBaseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
          retryDelay = retryDelayMs(response.headers.get('retry-after'), attempt);
        } else {
          observeRevision(response.headers, 'x-qveris-api-version', observedApiRevisions);
          observeRevision(response.headers, 'x-qveris-catalog-version', observedCatalogRevisions);
          if (!response.ok) {
            await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
            throw apiError(`HTTP ${response.status}`);
          }
          let payload;
          try {
            payload = await response.json();
          } catch {
            throw apiError(controller.signal.aborted ? 'API response timed out' : 'Invalid API response');
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
      } catch (error) {
        if (error?.benchmarkStage === 'api') throw error;
        if (attempt >= maxRetries) {
          throw apiError(controller.signal.aborted ? 'API request timed out' : 'Network request failed');
        }
        retryDelay = retryDelayMs(null, attempt);
      } finally {
        clearTimeout(timeout);
      }
      await sleep(retryDelay);
    }
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
    observedRevisions: () => ({
      api_revision: singleRevision(observedApiRevisions),
      catalog_revision: singleRevision(observedCatalogRevisions),
    }),
  };
}

function observeRevision(headers, name, revisions) {
  const value = headers?.get?.(name);
  if (typeof value === 'string' && value.trim()) revisions.add(value.trim());
}

function singleRevision(revisions) {
  if (revisions.size === 0) return 'unreported';
  if (revisions.size === 1) return [...revisions][0];
  return `mixed:${[...revisions].sort().join(',')}`;
}

function retryDelayMs(retryAfter, attempt) {
  if (retryAfter !== null) {
    const value = String(retryAfter).trim();
    if (/^\d+(?:\.\d+)?$/.test(value)) {
      return Math.min(Number(value) * 1000, 60_000);
    }
    if (/[a-z]/i.test(value)) {
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
    }
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
