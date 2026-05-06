/**
 * Qveris API Type Definitions
 *
 * This module contains TypeScript types that match the Qveris API schema.
 * Aligned with backend ToolInfo, SearchResponse, ToolCallResponse, and
 * the REST API documentation at docs/en-US/rest-api.md.
 *
 * @module types
 * @see {@link https://qveris.ai/api/v1} Qveris API Base URL
 */

// ============================================================================
// Search API Types
// ============================================================================

/**
 * Request body for the Search Tools API.
 */
export interface SearchRequest {
  /** Natural language search query describing the tool capability you need. */
  query: string;

  /**
   * Maximum number of results to return.
   * @default 20
   * @minimum 1
   * @maximum 100
   */
  limit?: number;

  /** Session identifier for tracking user sessions. */
  session_id?: string;
}

/**
 * Parameter definition for a tool.
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
 * Historical execution performance statistics for a tool.
 */
export interface ToolStats {
  /** Historical average execution time in milliseconds */
  avg_execution_time_ms?: number;

  /** Historical success rate (0.0 - 1.0) */
  success_rate?: number;

  /** Legacy fallback estimate in credits per call */
  cost?: number;
}

export interface BillingPrice {
  amount_credits: number;
  per?: number | null;
  unit?: string | null;
  unit_label?: string | null;
}

export interface BillingChargeLine {
  component_key: string;
  quantity?: number | null;
  unit?: string | null;
  unit_label?: string | null;
  price?: BillingPrice | null;
  amount_credits?: number | null;
  description?: string | null;
  is_adjustment?: boolean | null;
}

export interface BillingRule {
  metering_mode?: string;
  billing_unit?: string;
  billing_unit_label?: string;
  price?: BillingPrice | null;
  price_breakdown?: Record<string, unknown>[] | null;
  pricing_dimensions?: Record<string, unknown>[] | null;
  minimum_charge_credits?: number | null;
  snapshot_id?: number | null;
  snapshot_version?: string | null;
  runtime_pricing_version?: string | null;
  pricing_source_system?: string | null;
  description?: string;
}

export interface CompactBillingStatement {
  price?: BillingPrice | null;
  quantity?: number | null;
  charge_lines?: BillingChargeLine[] | null;
  minimum_charge_credits?: number | null;
  list_amount_credits?: number | null;
  requested_amount_credits?: number | null;
  summary?: string | null;
}

/**
 * Information about a tool returned from search results.
 * Contains everything needed to understand and execute the tool.
 */
export interface ToolInfo {
  /** Unique identifier for the tool (used in call) */
  tool_id: string;

  /** Human-readable display name */
  name: string;

  /** Detailed description of what the tool does */
  description: string;

  /** Tool categories/tags */
  categories?: string[];

  /** Name of the organization/service providing this tool */
  provider_name?: string;

  /** Description of the provider */
  provider_description?: string;

  /** Provider website URL */
  provider_website_url?: string;

  /**
   * Geographic availability of the tool.
   * - "global" - Available worldwide
   * - "US|CA" - Whitelist: only available in US and Canada
   * - "-CN|RU" - Blacklist: not available in China and Russia
   */
  region?: string;

  /** List of parameters the tool accepts */
  params?: ToolParameter[];

  /** Usage examples with sample parameters */
  examples?: ToolExamples;

  /** Historical execution performance statistics */
  stats?: ToolStats;

  /** Structured rule-level billing metadata when available */
  billing_rule?: BillingRule;

  /** Relevance score for the search query (0.0 - 1.0, higher = better match) */
  final_score?: number;

  /** Whether this tool has been executed before (verified in production) */
  has_last_execution?: boolean;

  /** Most recent execution record, if available */
  last_execution_record?: Record<string, unknown>;

  /** Documentation URL for the tool */
  docs_url?: string;

  /** Protocol type */
  protocol?: string;
}

/**
 * Performance statistics for a search operation.
 */
export interface SearchStats {
  /** Total time to complete the search in milliseconds */
  search_time_ms?: number;

  /** Vector recall count */
  vector_recall_count?: number;

  /** Fulltext recall count */
  fulltext_recall_count?: number;
}

/**
 * Response from the Search Tools API.
 */
export interface SearchResponse {
  /** The original search query */
  query?: string;

  /**
   * Unique identifier for this search.
   * Required when calling call for any tool from these results.
   */
  search_id: string;

  /** Total number of results returned */
  total?: number;

  /** Array of matching tools */
  results: ToolInfo[];

  /** Search performance statistics */
  stats?: SearchStats;

  /** User's remaining credits after this operation */
  remaining_credits?: number;

  /** Total elapsed time in milliseconds */
  elapsed_time_ms?: number;
}

// ============================================================================
// Get Tools by IDs API Types
// ============================================================================

/**
 * Request body for the Get Tools by IDs API.
 */
export interface GetToolsByIdsRequest {
  /** Array of tool IDs to retrieve information for. */
  tool_ids: string[];

  /** The search_id from the search that returned the tool(s). */
  search_id?: string;

  /** Session identifier for tracking user sessions. */
  session_id?: string;
}

// ============================================================================
// Execute API Types
// ============================================================================

/**
 * Request body for the Execute Tool API.
 */
export interface ExecuteRequest {
  /**
   * The search_id from the search that returned this tool.
   * Links the execution to the original search for analytics and billing.
   */
  search_id: string;

  /** Session identifier for tracking user sessions. */
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

  /**
   * JSON Schema describing the structure of the full content.
   * Helps the agent understand the data shape without downloading.
   */
  content_schema?: Record<string, unknown>;
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

  /** Execution duration in milliseconds (alternative field) */
  elapsed_time_ms?: number;

  /** Legacy fallback estimate; use usage audit or credits ledger for final charge */
  cost?: number;

  /** Structured pre-settlement billing statement when available */
  billing?: CompactBillingStatement;

  /** Legacy/full pre-settlement bill snapshot when returned directly */
  pre_settlement_bill?: Record<string, unknown>;

  /** User's remaining credits after this execution */
  remaining_credits?: number;

  /** Timestamp of execution (ISO 8601 format) */
  created_at?: string;
}

// ============================================================================
// Account Audit API Types
// ============================================================================

export interface ApiEnvelope<T> {
  status: string;
  message?: string;
  status_code?: number;
  data: T;
}

export interface CreditsResponse {
  remaining_credits: number;
  daily_free?: Record<string, unknown>;
  invite_reward?: Record<string, unknown>;
  welcome_bonus?: Record<string, unknown>;
  purchased?: Record<string, unknown>;
}

export interface UsageHistoryRequest {
  start_date?: string;
  end_date?: string;
  summary?: boolean;
  bucket?: string;
  event_type?: string;
  kind?: string;
  success?: boolean;
  charge_outcome?: string;
  search_id?: string;
  execution_id?: string;
  min_credits?: number;
  max_credits?: number;
  limit?: number;
  page?: number;
  page_size?: number;
}

export interface UsageEventItem {
  id: string;
  event_type: string;
  kind?: string | null;
  source_system: string;
  source_ref_type?: string | null;
  source_ref_id?: string | null;
  session_id?: string | null;
  search_id?: string | null;
  execution_id?: string | null;
  tool_id?: string | null;
  model?: string | null;
  query?: string | null;
  success: boolean;
  charge_outcome?: string | null;
  error_message?: string | null;
  billing_snapshot_status?: string | null;
  pre_settlement_bill?: Record<string, unknown> | null;
  settlement_result?: Record<string, unknown> | null;
  requested_amount_credits?: number | null;
  actual_amount_credits?: number | null;
  credits_ledger_entry_id?: string | null;
  display_target?: string | null;
  billing_summary?: string | null;
  pre_settlement_amount_credits?: number | null;
  settled_amount_credits?: number | null;
  created_at: string;
}

export interface UsageEventsResponse {
  items: UsageEventItem[];
  total: number;
  page: number;
  page_size: number;
  summary?: Record<string, unknown> | null;
}

export interface CreditsLedgerRequest {
  start_date?: string;
  end_date?: string;
  summary?: boolean;
  bucket?: string;
  entry_type?: string;
  direction?: string;
  min_credits?: number;
  max_credits?: number;
  limit?: number;
  page?: number;
  page_size?: number;
}

export interface CreditsLedgerItem {
  id: string;
  entry_type: string;
  amount_credits: number;
  source_system: string;
  source_ref_type?: string | null;
  source_ref_id?: string | null;
  pre_settlement_bill?: Record<string, unknown> | null;
  settlement_result?: Record<string, unknown> | null;
  balance_before?: Record<string, unknown> | null;
  balance_after?: Record<string, unknown> | null;
  ledger_metadata?: Record<string, unknown> | null;
  description?: string | null;
  created_at: string;
}

export interface CreditsLedgerResponse {
  items: CreditsLedgerItem[];
  total: number;
  page: number;
  page_size: number;
  summary?: Record<string, unknown> | null;
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

  /** Default request timeout in milliseconds */
  timeoutMs?: number;
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
