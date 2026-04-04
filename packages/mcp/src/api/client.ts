/**
 * Qveris API HTTP Client
 *
 * Provides a type-safe HTTP client for interacting with the Qveris REST API.
 * Handles authentication, request formatting, and error handling.
 *
 * @module api/client
 */

import type {
  SearchRequest,
  SearchResponse,
  GetToolsByIdsRequest,
  ExecuteRequest,
  ExecuteResponse,
  QverisClientConfig,
  ApiError,
} from '../types.js';

/** Production API base URL */
const DEFAULT_BASE_URL = 'https://qveris.ai/api/v1';

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
 * // Search for tools
 * const searchResult = await client.searchTools({
 *   query: 'weather API',
 *   limit: 5
 * });
 *
 * // Execute a tool
 * const execResult = await client.executeTool('tool-id', {
 *   search_id: searchResult.search_id,
 *   parameters: { city: 'London' }
 * });
 * ```
 */
export class QverisClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /**
   * Creates a new Qveris API client.
   *
   * @param config - Client configuration
   * @throws {Error} If apiKey is not provided
   */
  constructor(config: QverisClientConfig) {
    if (!config.apiKey) {
      throw new Error('Qveris API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Makes an authenticated HTTP request to the Qveris API.
   *
   * @param method - HTTP method
   * @param endpoint - API endpoint (relative to base URL)
   * @param body - Request body (will be JSON serialized)
   * @returns Parsed JSON response
   * @throws {ApiError} If the request fails
   */
  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage: string;
      let errorDetails: unknown;

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        errorMessage =
          (errorBody.message as string) ||
          (errorBody.error as string) ||
          response.statusText;
        errorDetails = errorBody;
      } catch {
        errorMessage = response.statusText || `HTTP ${response.status}`;
      }

      const error: ApiError = {
        status: response.status,
        message: errorMessage,
        details: errorDetails,
      };

      throw error;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Search for tools based on a natural language query.
   *
   * Finds tools that match the described capability. Results include
   * tool metadata, parameter schemas, and usage examples.
   *
   * @param request - Search parameters
   * @returns Search results with matching tools
   *
   * @example
   * ```typescript
   * const result = await client.searchTools({
   *   query: 'send SMS message',
   *   limit: 10,
   *   session_id: 'abcd1234-ab12-ab12-ab12-abcdef123456'
   * });
   *
   * console.log(`Found ${result.total} tools`);
   * for (const tool of result.results) {
   *   console.log(`- ${tool.name}: ${tool.description}`);
   * }
   * ```
   */
  async searchTools(request: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/search', request);
  }

  /**
   * Get tool descriptions by their IDs.
   *
   * Retrieves detailed information about specific tools when you already
   * know their tool_ids. Useful for refreshing tool metadata or getting
   * details for tools from previous searches.
   *
   * @param request - Request parameters with tool IDs
   * @returns Tool information matching the provided IDs
   *
   * @example
   * ```typescript
   * const result = await client.getToolsByIds({
   *   tool_ids: ['weather-tool-1', 'email-tool-2'],
   *   search_id: 'abcd1234-ab12-ab12-ab12-abcdef123456',
   *   session_id: 'abcd1234-ab12-ab12-ab12-abcdef123456'
   * });
   *
   * console.log(`Retrieved ${result.results.length} tools`);
   * for (const tool of result.results) {
   *   console.log(`- ${tool.name}: ${tool.description}`);
   * }
   * ```
   */
  async getToolsByIds(request: GetToolsByIdsRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/tools/by-ids', request);
  }

  /**
   * Execute a tool with the specified parameters.
   *
   * The tool_id must come from a previous searchTools call.
   * The search_id links this execution to that search for analytics.
   *
   * @param toolId - The tool identifier from search results
   * @param request - Execution parameters
   * @returns Execution result
   *
   * @example
   * ```typescript
   * const result = await client.executeTool('openweathermap_current', {
   *   search_id: 'abcd1234-ab12-ab12-ab12-abcdef123456',
   *   session_id: 'abcd1234-ab12-ab12-ab12-abcdef123456',
   *   parameters: {
   *     city: 'Tokyo',
   *     units: 'metric'
   *   }
   * });
   *
   * if (result.success) {
   *   console.log('Result:', result.result);
   * } else {
   *   console.error('Failed:', result.error_message);
   * }
   * ```
   */
  async executeTool(
    toolId: string,
    request: ExecuteRequest
  ): Promise<ExecuteResponse> {
    const endpoint = `/tools/execute?tool_id=${encodeURIComponent(toolId)}`;
    return this.request<ExecuteResponse>('POST', endpoint, request);
  }
}

/**
 * Creates a Qveris client from environment variables.
 *
 * Reads the API key from the QVERIS_API_KEY environment variable.
 *
 * @returns Configured Qveris client
 * @throws {Error} If QVERIS_API_KEY is not set
 *
 * @example
 * ```typescript
 * // Ensure QVERIS_API_KEY is set in your environment
 * const client = createClientFromEnv();
 * ```
 */
export function createClientFromEnv(): QverisClient {
  const apiKey = process.env.QVERIS_API_KEY;

  if (!apiKey) {
    throw new Error(
      'QVERIS_API_KEY environment variable is required.\n' +
      'Please set it to your Qveris API token.\n' +
      'Contact Qveris to obtain an API token.'
    );
  }

  return new QverisClient({ apiKey });
}

