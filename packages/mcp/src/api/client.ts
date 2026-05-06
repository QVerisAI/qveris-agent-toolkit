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
} from '../types.js';

/** Region-specific API base URLs */
const REGION_URLS: Record<string, string> = {
  global: 'https://qveris.ai/api/v1',
  cn: 'https://qveris.cn/api/v1',
};

/**
 * Detect region from API key prefix.
 * sk-cn-xxx → cn, sk-xxx → global
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

  constructor(config: QverisClientConfig) {
    if (!config.apiKey) {
      throw new Error('Qveris API key is required');
    }
    this.apiKey = config.apiKey;
    // Resolve base URL: explicit > env > key prefix auto-detect
    this.baseUrl = resolveBaseUrl(config.apiKey, config.baseUrl);
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Makes an authenticated HTTP request to the Qveris API.
   */
  private async request<T>(
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
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.defaultTimeoutMs,
    );

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

      if (!response.ok) {
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
          details: errorDetails,
        };

        throw error;
      }

      try {
        return await response.json() as T;
      } catch {
        const error: ApiError = {
          status: response.status,
          message: 'Invalid or empty JSON response from API',
        };
        throw error;
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err) {
        // ApiError — rethrow as-is
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        const error: ApiError = {
          status: 408,
          message: 'Request timed out. Check connectivity or increase timeout.',
        };
        throw error;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Search for tools based on a natural language query.
   * This is the Discover action and is free.
   */
  async searchTools(request: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/search', request);
  }

  /**
   * Get tool descriptions by their IDs.
   * This is the Inspect action and is free.
   */
  async getToolsByIds(request: GetToolsByIdsRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/tools/by-ids', request);
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
    return this.request<ApiEnvelope<CreditsResponse> | CreditsResponse>('GET', '/auth/credits');
  }

  /**
   * Query request-level usage audit history.
   */
  async getUsageHistory(
    request: UsageHistoryRequest
  ): Promise<ApiEnvelope<UsageEventsResponse> | UsageEventsResponse> {
    return this.request<ApiEnvelope<UsageEventsResponse> | UsageEventsResponse>(
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
 * (sk-cn-xxx → cn, sk-xxx → global), or overridden via QVERIS_REGION or QVERIS_BASE_URL.
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
