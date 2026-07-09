/**
 * Qveris API HTTP Client
 *
 * Provides a type-safe HTTP client for interacting with the Qveris REST API.
 * Handles authentication, request formatting, timeouts, and error handling.
 *
 * @module api/client
 */

import type {
  SearchRequest,
  SearchResponse,
  GetToolsByIdsRequest,
  ExecuteRequest,
  ExecuteResponse,
  CreditsResponse,
  UsageHistoryRequest,
  UsageEventsResponse,
  CreditsLedgerRequest,
  CreditsLedgerResponse,
  ApiEnvelope,
  QverisClientConfig,
  ApiError,
  ApiObservability,
  ApiOperation,
} from '../types.js';
import {
  computeRetryDelayMs,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  parseRetryAfterMs,
  resolveMaxRetries,
  RETRYABLE_STATUS,
} from '../retry.js';

/** Region-specific API base URLs */
const REGION_URLS: Record<string, string> = {
  global: 'https://qveris.ai/api/v1',
  cn: 'https://qveris.cn/api/v1',
};

/**
 * Detect region from API key prefix.
 * sk-cn-xxx -> cn, sk-xxx -> global
 */
function detectRegionFromKey(apiKey: string): string {
  return apiKey.startsWith('sk-cn-') ? 'cn' : 'global';
}

/**
 * Resolve the base URL for the QVeris API.
 * Priority: explicit baseUrl > QVERIS_BASE_URL env > QVERIS_REGION env > key prefix auto-detect > default
 */
function resolveBaseUrl(apiKey: string, explicitBaseUrl?: string): string {
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, '');
  if (process.env.QVERIS_BASE_URL) return process.env.QVERIS_BASE_URL.replace(/\/+$/, '');
  if (process.env.QVERIS_REGION) {
    const region = process.env.QVERIS_REGION.toLowerCase();
    return REGION_URLS[region] ?? REGION_URLS.global;
  }
  return REGION_URLS[detectRegionFromKey(apiKey)];
}

/** Default timeout: 30s for search/inspect, 120s for execute */
const DEFAULT_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 120_000;

/**
 * Qveris API Client
 *
 * A lightweight HTTP client for the Qveris API using native fetch.
 * Requires Node.js 18+ for native fetch support.
 *
 * @example
 * ```typescript
 * const client = new QverisClient({ apiKey: 'your-api-key' });
 *
 * const searchResult = await client.searchTools({
 *   query: 'weather API',
 *   limit: 5
 * });
 *
 * const execResult = await client.executeTool('tool-id', {
 *   search_id: searchResult.search_id,
 *   parameters: { city: 'London' }
 * });
 * ```
 */
export class QverisClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private rateLimitRetries = 0;

  constructor(config: QverisClientConfig) {
    if (!config.apiKey) {
      throw new Error('Qveris API key is required');
    }
    this.apiKey = config.apiKey;
    // Resolve base URL: explicit > env > key prefix auto-detect
    this.baseUrl = resolveBaseUrl(config.apiKey, config.baseUrl);
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Retries for 429/503, configurable via env (the server is env-configured).
    this.maxRetries = resolveMaxRetries(process.env.QVERIS_MAX_RETRIES);
  }

  /**
   * How many times the client has backed off on a rate-limited (429) /
   * transient (503) response so far — retried pressure, not failure.
   */
  get rateLimitRetryCount(): number {
    return this.rateLimitRetries;
  }

  /** Sleep for `ms` (a seam so tests can stub out the wait). */
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Makes an authenticated HTTP request to the Qveris API.
   */
  private async request<T>(
    operation: ApiOperation,
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown,
    timeoutMs?: number,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const resolvedTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const requestContext: ApiObservability = {
      source: 'qveris_api',
      operation,
      method,
      endpoint,
      url: url.toString(),
      ...(Object.keys(queryParams).length > 0 && { query_params: queryParams }),
      timeout_ms: resolvedTimeoutMs,
    };

    // Retry rate-limited (429) / transient (503) responses: honor Retry-After,
    // otherwise exponential backoff with jitter, bounded by maxRetries. Each
    // attempt is a fresh fetch with its own timeout.
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), resolvedTimeoutMs);
      let retryDelayMs: number | null = null;

      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
          retryDelayMs = computeRetryDelayMs({
            retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
            attempt,
            baseDelayMs: DEFAULT_BASE_DELAY_MS,
            maxDelayMs: DEFAULT_MAX_DELAY_MS,
          });
          // Discard the body so the connection is released before we retry.
          await response.body?.cancel().catch(() => undefined);
          this.rateLimitRetries++;
        } else if (!response.ok) {
          const status = response.status;
          let errorMessage: string;
          let errorDetails: unknown;

          try {
            const errorBody = (await response.json()) as Record<string, unknown>;
            errorMessage =
              (errorBody.error_message as string) ||
              (errorBody.message as string) ||
              (errorBody.error as string) ||
              response.statusText;
            errorDetails = errorBody;
          } catch {
            errorMessage = response.statusText || `HTTP ${status}`;
          }

          // Provide actionable hints for specific status codes
          if (status === 402) {
            const pricingHost = this.baseUrl.includes('qveris.cn') ? 'https://qveris.cn' : 'https://qveris.ai';
            errorMessage = `Insufficient credits. ${errorMessage}. Purchase credits at ${pricingHost}/pricing`;
          }

          const error: ApiError = {
            status,
            message: errorMessage,
            ...(errorDetails !== undefined && { details: errorDetails }),
            observability: withErrorContext(
              requestContext,
              'http_error',
              status,
              extractRequestId(response),
            ),
          };

          throw error;
        } else {
          try {
            return await response.json() as T;
          } catch {
            const error: ApiError = {
              status: response.status,
              message: 'Invalid or empty JSON response from API',
              observability: withErrorContext(
                requestContext,
                'invalid_json',
                response.status,
                extractRequestId(response),
              ),
            };
            throw error;
          }
        }
      } catch (err: unknown) {
        if (isApiError(err)) {
          throw err;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          const cause = getErrorCause(err);
          const error: ApiError = {
            status: 408,
            message: 'Request timed out. Check connectivity or increase timeout.',
            observability: withErrorContext(requestContext, 'timeout', 0),
            ...(cause && { cause }),
          };
          throw error;
        }
        const cause = getErrorCause(err);
        const error: ApiError = {
          status: 0,
          message: getErrorMessage(err, 'Network request failed'),
          observability: withErrorContext(requestContext, 'network_error', 0),
          ...(cause && { cause }),
        };
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      // Only reached on the retry path (success returns, errors throw above).
      await this.sleep(retryDelayMs ?? 0);
    }
  }

  /**
   * Search for tools based on a natural language query.
   * This is the Discover action and is free.
   */
  async searchTools(request: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('discover', 'POST', '/search', request);
  }

  /**
   * Get tool descriptions by their IDs.
   * This is the Inspect action and is free.
   */
  async getToolsByIds(request: GetToolsByIdsRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('inspect', 'POST', '/tools/by-ids', request);
  }

  /**
   * Execute a tool with the specified parameters.
   * This is the Call action; the response may include pre-settlement billing.
   * Uses a longer timeout (120s) by default.
   */
  async executeTool(
    toolId: string,
    request: ExecuteRequest
  ): Promise<ExecuteResponse> {
    const endpoint = `/tools/execute?tool_id=${encodeURIComponent(toolId)}`;
    return this.request<ExecuteResponse>(
      'call',
      'POST',
      endpoint,
      request,
      EXECUTE_TIMEOUT_MS,
    );
  }

  /**
   * Get current credit balance and bucket details.
   */
  async getCredits(): Promise<ApiEnvelope<CreditsResponse> | CreditsResponse> {
    return this.request<ApiEnvelope<CreditsResponse> | CreditsResponse>('credits', 'GET', '/auth/credits');
  }

  /**
   * Query request-level usage audit history.
   */
  async getUsageHistory(
    request: UsageHistoryRequest
  ): Promise<ApiEnvelope<UsageEventsResponse> | UsageEventsResponse> {
    return this.request<ApiEnvelope<UsageEventsResponse> | UsageEventsResponse>(
      'usage_history',
      'GET',
      '/auth/usage/history/v2',
      undefined,
      this.defaultTimeoutMs,
      request as Record<string, unknown>,
    );
  }

  /**
   * Query final credits ledger entries.
   */
  async getCreditsLedger(
    request: CreditsLedgerRequest
  ): Promise<ApiEnvelope<CreditsLedgerResponse> | CreditsLedgerResponse> {
    return this.request<ApiEnvelope<CreditsLedgerResponse> | CreditsLedgerResponse>(
      'credits_ledger',
      'GET',
      '/auth/credits/ledger',
      undefined,
      this.defaultTimeoutMs,
      request as Record<string, unknown>,
    );
  }
}

/**
 * Creates a Qveris client from environment variables.
 * Reads the API key from QVERIS_API_KEY. Region is auto-detected from key prefix
 * (sk-cn-xxx -> cn, sk-xxx -> global), or overridden via QVERIS_REGION or QVERIS_BASE_URL.
 */
export function createClientFromEnv(): QverisClient {
  const apiKey = process.env.QVERIS_API_KEY;

  if (!apiKey) {
    throw new Error(
      'QVERIS_API_KEY environment variable is required.\n' +
      'Global: https://qveris.ai/account?page=api-keys\n' +
      'China:  https://qveris.cn/account?page=api-keys'
    );
  }

  const client = new QverisClient({ apiKey });
  const region = detectRegionFromKey(apiKey);
  const effectiveUrl = resolveBaseUrl(apiKey);
  console.error(`Region: ${region} (${effectiveUrl})`);

  return client;
}

function withErrorContext(
  context: ApiObservability,
  errorType: NonNullable<ApiObservability['error_type']>,
  httpStatus?: number,
  requestId?: string,
): ApiObservability {
  return {
    ...context,
    error_type: errorType,
    ...(httpStatus !== undefined && { http_status: httpStatus }),
    ...(requestId && { request_id: requestId }),
  };
}

function extractRequestId(response: Response): string | undefined {
  const headers = response.headers;
  return (
    headers?.get('x-request-id') ??
    headers?.get('x-qveris-request-id') ??
    headers?.get('x-correlation-id') ??
    undefined
  );
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function getErrorCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const cause = error.cause;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause) return cause;
  return undefined;
}
