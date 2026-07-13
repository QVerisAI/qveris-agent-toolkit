/**
 * QVeris API client.
 *
 * A lightweight, dependency-free typed client for the QVeris REST API using
 * native fetch (Node.js 18+). Handles authentication, endpoint resolution,
 * success-envelope unwrapping, timeouts, and error normalization.
 *
 * The wire semantics mirror the Python SDK (`qveris` on PyPI) and the MCP
 * server (`@qverisai/mcp`).
 *
 * @module client
 */

import { QverisApiError } from './errors.js';
import {
  computeRetryDelayMs,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  parseRetryAfterMs,
  resolveMaxRetries,
  RETRYABLE_STATUS,
} from './retry.js';
import type {
  ApiEnvelope,
  ApiError,
  ApiObservability,
  ApiOperation,
  CreditsLedgerRequest,
  CreditsLedgerResponse,
  CreditsResponse,
  ExecuteResponse,
  QverisClientConfig,
  SearchResponse,
  UsageEventsResponse,
  UsageHistoryRequest,
} from './types.js';

const DEFAULT_BASE_URL = 'https://qveris.ai/api/v1';

/**
 * Resolve the base URL for the QVeris API.
 * Priority: explicit baseUrl > QVERIS_BASE_URL env > built-in default.
 * API keys and QVERIS_REGION never affect endpoint selection.
 */
function resolveBaseUrl(explicitBaseUrl?: string): string {
  if (explicitBaseUrl !== undefined) return normalizeBaseUrl(explicitBaseUrl);
  if (typeof process !== 'undefined' && Object.prototype.hasOwnProperty.call(process.env, 'QVERIS_BASE_URL')) {
    return normalizeBaseUrl(process.env.QVERIS_BASE_URL ?? '');
  }
  return DEFAULT_BASE_URL;
}

function normalizeBaseUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error('QVeris API base URL must not be empty');
  if (/\s/.test(candidate) || candidate.includes('\\')) {
    throw new Error('QVeris API base URL must be a valid HTTP(S) URL');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('QVeris API base URL must be a valid HTTP(S) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('QVeris API base URL must be a valid HTTP(S) URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('QVeris API base URL must not contain credentials, a query, or a fragment');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

/** Default timeout: 30s for discover/inspect/audit, 120s for call */
const DEFAULT_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 120_000;

/** Options for {@link Qveris.discover}. */
export interface DiscoverOptions {
  /** Maximum number of results (1-100, server default 20) */
  limit?: number;
  /** Session identifier for tracking */
  sessionId?: string;
  /** Per-request timeout override in milliseconds */
  timeoutMs?: number;
}

/** Options for {@link Qveris.inspect}. */
export interface InspectOptions {
  /** The search_id from the discover call that returned the tool(s) */
  searchId?: string;
  /** Session identifier for tracking */
  sessionId?: string;
  /** Per-request timeout override in milliseconds */
  timeoutMs?: number;
}

/** Options for {@link Qveris.call}. */
export interface CallOptions {
  /** Key-value parameters matching the tool's parameter schema */
  parameters: Record<string, unknown>;
  /** The search_id from the discover call that returned this tool */
  searchId?: string;
  /** Session identifier for tracking */
  sessionId?: string;
  /** Max response bytes before truncation (-1 for no limit, server default 20480) */
  maxResponseSize?: number;
  /** Per-request timeout override in milliseconds (default 120s) */
  timeoutMs?: number;
}

/**
 * QVeris API client.
 *
 * @example
 * ```typescript
 * import { Qveris } from '@qverisai/sdk';
 *
 * const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
 *
 * const found = await qveris.discover('stock price market data API', { limit: 5 });
 * const tool = found.results[0];
 *
 * const outcome = await qveris.call(tool.tool_id, {
 *   searchId: found.search_id,
 *   parameters: { symbol: 'AAPL' },
 * });
 * ```
 */
export class Qveris {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private rateLimitRetries = 0;

  constructor(config: QverisClientConfig) {
    if (!config.apiKey) {
      throw new Error('QVeris API key is required.\n' + 'Create one at https://qveris.ai/account?page=api-keys');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = resolveMaxRetries(config.maxRetries);
  }

  /**
   * How many times the client has backed off on a rate-limited (429) /
   * transient (503) response so far. Rate-limit backoff is retried pressure,
   * not failure — observe this rather than counting the retried responses.
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
   * Create a client from the QVERIS_API_KEY environment variable.
   * An explicit baseUrl override takes priority over QVERIS_BASE_URL.
   */
  static fromEnv(overrides?: Omit<QverisClientConfig, 'apiKey'>): Qveris {
    const apiKey = process.env.QVERIS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'QVERIS_API_KEY environment variable is required.\n' + 'Create one at https://qveris.ai/account?page=api-keys',
      );
    }
    return new Qveris({ apiKey, ...overrides });
  }

  /**
   * Discover capabilities from a natural-language query. Free.
   */
  async discover(query: string, options: DiscoverOptions = {}): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      'discover',
      'POST',
      '/search',
      {
        query,
        ...(options.limit !== undefined && { limit: options.limit }),
        ...(options.sessionId !== undefined && { session_id: options.sessionId }),
      },
      options.timeoutMs,
    );
  }

  /**
   * Inspect capabilities by id to get current parameter schemas. Free.
   * An empty id list resolves locally without a network request.
   */
  async inspect(toolIds: string | string[], options: InspectOptions = {}): Promise<SearchResponse> {
    const ids = typeof toolIds === 'string' ? [toolIds] : toolIds;
    if (ids.length === 0) {
      return { search_id: options.searchId ?? '', total: 0, results: [] };
    }
    return this.request<SearchResponse>(
      'inspect',
      'POST',
      '/tools/by-ids',
      {
        tool_ids: ids,
        ...(options.searchId !== undefined && { search_id: options.searchId }),
        ...(options.sessionId !== undefined && { session_id: options.sessionId }),
      },
      options.timeoutMs,
    );
  }

  /**
   * Call a capability. The response may include pre-settlement billing;
   * final charges are reflected in usage() and ledger().
   */
  async call(toolId: string, options: CallOptions): Promise<ExecuteResponse> {
    return this.request<ExecuteResponse>(
      'call',
      'POST',
      `/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
      {
        parameters: options.parameters,
        search_id: options.searchId ?? null,
        ...(options.sessionId !== undefined && { session_id: options.sessionId }),
        ...(options.maxResponseSize !== undefined && {
          max_response_size: options.maxResponseSize,
        }),
      },
      options.timeoutMs ?? EXECUTE_TIMEOUT_MS,
    );
  }

  /** Get current credit balance and bucket details. */
  async credits(): Promise<CreditsResponse> {
    return this.request<CreditsResponse>('credits', 'GET', '/auth/credits');
  }

  /** Query request-level usage audit history. */
  async usage(filters: UsageHistoryRequest = {}): Promise<UsageEventsResponse> {
    return this.request<UsageEventsResponse>(
      'usage_history',
      'GET',
      '/auth/usage/history/v2',
      undefined,
      undefined,
      filters as Record<string, unknown>,
    );
  }

  /** Query final credits ledger entries. */
  async ledger(filters: CreditsLedgerRequest = {}): Promise<CreditsLedgerResponse> {
    return this.request<CreditsLedgerResponse>(
      'credits_ledger',
      'GET',
      '/auth/credits/ledger',
      undefined,
      undefined,
      filters as Record<string, unknown>,
    );
  }

  /**
   * Makes an authenticated HTTP request and unwraps success envelopes.
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
      // eslint-disable-next-line no-useless-assignment -- TS definite-assignment needs the init across try/finally
      let retryDelayMs: number | null = null;
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
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
          // (`.cancel?.()` so a body without cancel — e.g. a test double —
          // can't throw here and mask the rate-limit as a network error.)
          await response.body?.cancel?.().catch(() => undefined);
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

          if (status === 402) {
            const pricingHost = this.baseUrl.includes('qveris.cn') ? 'https://qveris.cn' : 'https://qveris.ai';
            errorMessage = `Insufficient credits. ${errorMessage}. Purchase credits at ${pricingHost}/pricing`;
          }

          throw new QverisApiError({
            status,
            message: errorMessage,
            ...(errorDetails !== undefined && { details: errorDetails }),
            observability: withErrorContext(requestContext, 'http_error', status, extractRequestId(response)),
          });
        } else {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new QverisApiError({
              status: response.status,
              message: 'Invalid or empty JSON response from API',
              observability: withErrorContext(
                requestContext,
                'invalid_json',
                response.status,
                extractRequestId(response),
              ),
            });
          }

          return this.unwrapEnvelope<T>(payload, requestContext);
        }
      } catch (err: unknown) {
        if (err instanceof QverisApiError) {
          throw err;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          throw new QverisApiError({
            status: 408,
            message: 'Request timed out. Check connectivity or increase timeout.',
            observability: withErrorContext(requestContext, 'timeout', 0),
            ...(errorCause(err) && { cause: errorCause(err) }),
          });
        }
        throw new QverisApiError({
          status: 0,
          message: err instanceof Error && err.message ? err.message : 'Network request failed',
          observability: withErrorContext(requestContext, 'network_error', 0),
          ...(errorCause(err) && { cause: errorCause(err) }),
        });
      } finally {
        clearTimeout(timeout);
      }

      // Only reached on the retry path (success returns, errors throw above).
      await this.sleep(retryDelayMs ?? 0);
    }
  }

  /**
   * Unwrap `{status: "success", data: ...}` envelopes; raw payloads pass
   * through. A failure envelope throws before any result parsing, matching
   * the Python SDK behavior.
   */
  private unwrapEnvelope<T>(payload: unknown, context: ApiObservability): T {
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'status' in payload &&
      'data' in payload &&
      typeof (payload as { status: unknown }).status === 'string'
    ) {
      const envelope = payload as ApiEnvelope<T>;
      if (envelope.status !== 'success') {
        throw new QverisApiError({
          status: envelope.status_code ?? 400,
          message: envelope.message ?? `API returned status "${envelope.status}"`,
          details: payload,
          observability: withErrorContext(context, 'http_error', envelope.status_code ?? 400),
        });
      }
      return envelope.data;
    }
    return payload as T;
  }
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
    headers?.get('x-request-id') ?? headers?.get('x-qveris-request-id') ?? headers?.get('x-correlation-id') ?? undefined
  );
}

function errorCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const cause = error.cause;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause) return cause;
  return undefined;
}

export type { ApiError };
