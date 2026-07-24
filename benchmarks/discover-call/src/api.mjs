const DEFAULT_BASE_URL = 'https://qveris.ai/api/v1';
const RETRYABLE_STATUS = new Set([429, 503]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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

  async function request(path, body, { retryAmbiguousFailures = true, retryableStatuses = RETRYABLE_STATUS } = {}) {
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
        if (retryableStatuses.has(response.status) && attempt < maxRetries) {
          await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
          retryDelay = retryDelayMs(response.headers.get('retry-after'), attempt);
        } else {
          observeRevision(response.headers, 'x-qveris-api-version', observedApiRevisions);
          observeRevision(response.headers, 'x-qveris-catalog-version', observedCatalogRevisions);
          if (!response.ok) {
            await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
            throw apiError(`HTTP ${response.status}`, `http_${response.status}`);
          }
          let payload;
          try {
            payload = await response.json();
          } catch {
            if (controller.signal.aborted) {
              const error = new Error('response timeout');
              error.apiTimeoutPhase = 'response';
              throw error;
            }
            throw apiError('Invalid API response', 'invalid_response');
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
              throw apiError('API returned a failure envelope', 'failure_envelope');
            }
            return payload.data;
          }
          return payload;
        }
      } catch (error) {
        if (error?.benchmarkStage === 'api') throw error;
        if (attempt >= maxRetries || !retryAmbiguousFailures) {
          if (controller.signal.aborted) {
            throw apiError(
              error?.apiTimeoutPhase === 'response' ? 'API response timed out' : 'API request timed out',
              error?.apiTimeoutPhase === 'response' ? 'response_timeout' : 'request_timeout',
            );
          }
          throw apiError('Network request failed', 'network_failure');
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
    discover: ({ query, limit, sessionId }) =>
      request('/search', { query, limit, session_id: sessionId, view: 'routing' }),
    inspect: ({ toolIds, discoveryId, sessionId }) =>
      request('/tools/by-ids', {
        tool_ids: toolIds,
        ...(discoveryId ? { search_id: discoveryId } : {}),
        session_id: sessionId,
        view: 'lean',
      }),
    call: ({ toolId, discoveryId, sessionId, model, parameters }) =>
      request(
        `/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
        {
          parameters,
          search_id: discoveryId ?? null,
          session_id: sessionId,
          model,
          respond_with: 'full',
        },
        {
          retryAmbiguousFailures: false,
          retryableStatuses: new Set([429]),
        },
      ),
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
  if (parsed.protocol !== 'https:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('QVERIS_BASE_URL must use HTTPS except for loopback development');
  }
  if (candidate.includes('?') || candidate.includes('#')) {
    throw new Error('QVERIS_BASE_URL must not contain a query or fragment');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function apiError(message, reason) {
  const error = new Error(message);
  error.benchmarkStage = 'api';
  error.benchmarkReason = reason;
  return error;
}
