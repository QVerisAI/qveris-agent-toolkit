/**
 * Qveris API Type Definitions
 *
 * This module contains TypeScript types that match the Qveris API v0.1.6 schema.
 * All types are fully documented for IDE autocompletion and developer experience.
 *
 * @module types
 * @see {@link https://qveris.ai/api/v1} Qveris API Base URL
 */

// ============================================================================
// Search API Types
// ============================================================================

/**
 * Request body for the Search Tools API.
 *
 * @example
 * ```typescript
 * const request: SearchRequest = {
 *   query: "weather forecast API",
 *   limit: 10,
 *   session_id: "abcd1234-ab12-ab12-ab12-abcdef123456"
 * };
 * ```
 */
export interface SearchRequest {
  /**
   * Natural language search query describing the tool capability you need.
   * @example "weather forecast API"
   * @example "send email notification"
   */
  query: string;

  /**
   * Maximum number of results to return.
   * @default 20
   * @minimum 1
   * @maximum 100
   */
  limit?: number;

  /**
   * Session identifier for tracking user sessions.
   * Same ID corresponds to the same user session.
   */
  session_id?: string;
}

/**
 * Parameter definition for a tool.
 * Describes a single input parameter that a tool accepts.
 */
export interface ToolParameter {
  /** Parameter name (used as key in the parameters object) */
  name: string;

  /** Data type of the parameter */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Whether this parameter must be provided */
  required: boolean;

  /** Human-readable description of what this parameter does */
  description: string;

  /** If present, restricts valid values to this list */
  enum?: string[];
}

/**
 * Example usage for a tool, showing sample parameters.
 */
export interface ToolExamples {
  /** Sample parameter values demonstrating typical usage */
  sample_parameters?: Record<string, unknown>;
}

/**
 * Information about a tool returned from search results.
 * Contains everything needed to understand and execute the tool.
 */
export interface ToolInfo {
  /** Unique identifier for the tool (used in execute_tool) */
  tool_id: string;

  /** Human-readable display name */
  name: string;

  /** Detailed description of what the tool does */
  description: string;

  /** Name of the organization/service providing this tool */
  provider_name?: string;

  /** Description of the provider */
  provider_description?: string;

  /**
   * Geographic availability of the tool.
   * - "global" - Available worldwide
   * - "US|CA" - Whitelist: only available in US and Canada
   * - "!CN|RU" - Blacklist: not available in China and Russia
   */
  region?: string;

  /** Average response latency in milliseconds */
  avg_latency_ms?: number;

  /** List of parameters the tool accepts */
  params?: ToolParameter[];

  /** Usage examples with sample parameters */
  examples?: ToolExamples;
}

/**
 * Performance statistics for a search operation.
 */
export interface SearchStats {
  /** Total time to complete the search in milliseconds */
  search_time_ms: number;
}

/**
 * Response from the Search Tools API.
 */
export interface SearchResponse {
  /** The original search query */
  query?: string;

  /**
   * Unique identifier for this search.
   * Required when calling execute_tool for any tool from these results.
   */
  search_id: string;

  /** Total number of results returned */
  total?: number;

  /** Array of matching tools */
  results: ToolInfo[];

  /** Search performance statistics */
  stats?: SearchStats;
}

// ============================================================================
// Get Tools by IDs API Types
// ============================================================================

/**
 * Request body for the Get Tools by IDs API.
 *
 * @example
 * ```typescript
 * const request: GetToolsByIdsRequest = {
 *   tool_ids: ["tool-1", "tool-2"],
 *   search_id: "search-123",
 *   session_id: "abcd1234-ab12-ab12-ab12-abcdef123456"
 * };
 * ```
 */
export interface GetToolsByIdsRequest {
  /**
   * Array of tool IDs to retrieve information for.
   */
  tool_ids: string[];

  /**
   * The search_id from the search that returned the tool(s).
   * Optional but recommended for analytics and billing.
   */
  search_id?: string;

  /**
   * Session identifier for tracking user sessions.
   * Same ID corresponds to the same user session.
   */
  session_id?: string;
}

// ============================================================================
// Execute API Types
// ============================================================================

/**
 * Request body for the Execute Tool API.
 *
 * @example
 * ```typescript
 * const request: ExecuteRequest = {
 *   search_id: "abcd1234-ab12-ab12-ab12-abcdef123456",
 *   session_id: "abcd1234-ab12-ab12-ab12-abcdef123456",
 *   parameters: { city: "London", units: "metric" },
 *   max_response_size: 20480
 * };
 * ```
 */
export interface ExecuteRequest {
  /**
   * The search_id from the search that returned this tool.
   * Links the execution to the original search for analytics.
   */
  search_id: string;

  /**
   * Session identifier for tracking user sessions.
   * Same ID corresponds to the same user session.
   */
  session_id?: string;

  /**
   * Key-value pairs of parameters to pass to the tool.
   * Must match the parameter schema from the tool's definition.
   */
  parameters: Record<string, unknown>;

  /**
   * Maximum size of response data in bytes.
   * If the tool generates data longer than this, it will be truncated
   * and a download URL will be provided for the full content.
   * @default 20480 (20KB)
   * @minimum -1 (-1 means no limit)
   */
  max_response_size?: number;
}

/**
 * Result data when the response fits within max_response_size.
 */
export interface ExecuteResultData {
  /** The actual result data from the tool execution */
  data: unknown;
}

/**
 * Result data when the response exceeds max_response_size.
 * Provides truncated content and a URL to download the full result.
 */
export interface ExecuteResultTruncated {
  /** Explanation message about the truncation */
  message: string;

  /**
   * URL to download the complete result file.
   * Valid for 120 minutes.
   */
  full_content_file_url: string;

  /**
   * The initial portion of the response (max_response_size bytes).
   * Useful for previewing the data structure.
   */
  truncated_content: string;
}

/**
 * Union type for execution results (either full data or truncated).
 */
export type ExecuteResult = ExecuteResultData | ExecuteResultTruncated;

/**
 * Response from the Execute Tool API.
 */
export interface ExecuteResponse {
  /** Unique identifier for this execution record */
  execution_id: string;

  /** The tool that was executed */
  tool_id: string;

  /** The parameters that were passed to the tool */
  parameters: Record<string, unknown>;

  /**
   * The execution result.
   * Contains either `data` (if within size limit) or truncation info.
   */
  result?: ExecuteResult;

  /** Whether the execution completed successfully */
  success: boolean;

  /**
   * Error message if execution failed.
   * Common reasons: insufficient balance, quota exceeded, invalid parameters.
   */
  error_message?: string | null;

  /** Execution duration in seconds */
  execution_time?: number;

  /** Timestamp of execution (ISO 8601 format) */
  created_at: string;
}

// ============================================================================
// API Client Types
// ============================================================================

/**
 * Configuration options for the Qveris API client.
 */
export interface QverisClientConfig {
  /** API authentication token */
  apiKey: string;

  /** Base URL for the API (defaults to production) */
  baseUrl?: string;
}

/**
 * Error response from the Qveris API.
 */
export interface ApiError {
  /** HTTP status code */
  status: number;

  /** Error message */
  message: string;

  /** Original error details if available */
  details?: unknown;
}

