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
   * Minimum: 1. Maximum: 100.
   * @default 20
   */
  limit?: number;

  /** Session identifier for tracking user sessions. */
  session_id?: string;

  /** Response projection. Omit for the legacy/full response shape. */
  view?: 'routing' | 'full';

  /** Response language. Omit to use server-side language negotiation. */
  lang?: 'zh' | 'en';
}

/**
 * Parameter definition for a tool.
 */
export interface ToolParameter {
  /** Parameter name (used as key in the parameters object) */
  name: string;

  /** Data type of the parameter */
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

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
  sample_count?: number;
  quality_sample_count?: number;
  metrics_sample_count?: number;
  success_rate_sample_count?: number;
  latency_sample_count?: number;
  minimum_sample_count?: number;
  success_rate_minimum_sample_count?: number;
  latency_minimum_sample_count?: number;
  data_status?: 'available' | 'insufficient' | 'stale' | 'unavailable';
  quality_data_status?: 'available' | 'insufficient' | 'stale' | 'unavailable';
  success_rate_status?: 'available' | 'insufficient' | 'stale' | 'unavailable';
  latency_status?: 'available' | 'insufficient' | 'stale' | 'unavailable';
  metric_window?: string;
  window?: string;
  window_label?: string;
  window_start?: string;
  window_end?: string;
  metrics_updated_at?: string;
  last_checked_at?: string;
  /** Historical average execution time in milliseconds */
  avg_execution_time_ms?: number | null;

  /** Historical success rate (0.0 - 1.0) */
  success_rate?: number | null;

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
  final_amount_credits?: number;
  recorded_amount_credits?: number;
  settlement_state?: string;
  settlement_status?: string;
  execution_intent_id?: string | null;
  charge_event_id?: string | null;
  price?: BillingPrice | null;
  quantity?: number | null;
  charge_lines?: BillingChargeLine[] | null;
  minimum_charge_credits?: number | null;
  list_amount_credits?: number | null;
  requested_amount_credits?: number | null;
  summary?: string | null;
}

/**
 * Category/tag attached to a tool.
 * Current API responses return category objects; legacy responses returned
 * plain strings, so `ToolInfo.categories` accepts both.
 */
export interface ToolCategory {
  slug?: string;
  name?: string;
  description?: string;
}

/**
 * Coverage tag attached to a capability (e.g. market coverage).
 */
export interface ToolCapabilityTag {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
}

/**
 * Standardized capability descriptor attached to a tool
 * (e.g. "MKT.BARS.ADJUSTED" with market coverage tags).
 */
export interface ToolCapability {
  id?: string;
  tag?: ToolCapabilityTag[];
}

/** Any JSON value preserved from a provider-owned parameter contract. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A legacy parameter-definition list or any provider-owned JSON contract. */
export type ToolParameterContract = ToolParameter[] | JsonValue;

export type VerificationStatus = 'unverified' | 'verifying' | 'verified' | 'stale' | 'failed' | 'restricted';

export type VerificationCheckName =
  | 'schema'
  | 'authentication'
  | 'description_contract'
  | 'provider_identity'
  | 'permissions'
  | 'freshness'
  | 'live_check';

export interface VerificationCheck {
  name: VerificationCheckName;
  status: 'missing' | 'verifying' | 'passed' | 'stale' | 'failed' | 'restricted';
  checked_at?: string | null;
  evidence_digest?: string | null;
  reason?: string | null;
}

export interface CatalogVerification {
  status: VerificationStatus;
  policy_version: string;
  required_checks: string[];
  checks: VerificationCheck[];
  verified_at?: string | null;
  expires_at?: string | null;
  test_run_digest?: string | null;
  quality_issues: string[];
}

export interface RegionRestrictions {
  allow: string[];
  deny: string[];
}

export interface ExecutionRestrictions {
  callable: boolean;
  eligibility: 'unknown' | 'not_required' | 'required' | 'restricted';
  license: 'unknown' | 'not_required' | 'required' | 'approved' | 'restricted';
  regions: RegionRestrictions;
  commercial_use: 'unknown' | 'allowed' | 'conditional' | 'prohibited';
  data_as_of?: string | null;
  warnings: string[];
  technical?: 'unknown' | 'ready' | 'blocked';
  authentication?: 'unknown' | 'ready' | 'required' | 'blocked';
  region_status?: 'unknown' | 'ready' | 'conditional' | 'blocked';
  freshness?: 'unknown' | 'fresh' | 'stale' | 'failed';
  price_certainty?: 'unknown' | 'estimated' | 'exact';
  confidence?: number;
  allowed_actions?: string[];
  blocked_actions?: string[];
  next_action?: string;
  retryable?: boolean;
}

/**
 * Information about a tool returned from search results.
 * Contains everything needed to understand and execute the tool.
 */
export interface ToolInfo {
  /** Unique identifier for the tool (used in call) */
  tool_id: string;

  /** Stable public service identity when the backend can prove provider equivalence. */
  service_id?: string;

  /** Human-readable display name */
  name?: string;

  /** Detailed description of what the tool does */
  description?: string;

  /** Compact capability label returned by the routing projection. */
  capability?: string;

  /** Compact cost class returned by the routing projection. */
  cost_class?: string;

  /** Compact reliability grade returned by the routing projection. */
  reliability?: string;

  /** Whether the capability supports point-in-time requests. */
  as_of_support?: boolean;

  /** Tool categories/tags: category objects, or plain strings in legacy responses */
  categories?: Array<string | ToolCategory>;

  /** Standardized capability descriptors with coverage tags */
  capabilities?: ToolCapability[];

  /** Provider identifier */
  provider_id?: string;

  /** Name of the organization/service providing this tool */
  provider_name?: string | Record<string, string>;

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

  /** Provider parameter contract preserved exactly as JSON. */
  params?: ToolParameterContract;
  tool_name?: string;
  category?: string;
  score?: number;
  cost?: number | string;
  calls_count?: string;
  parameters?: JsonValue;
  input_schema?: JsonValue;
  parameters_schema?: JsonValue;
  query_params?: JsonValue;
  body_params?: JsonValue;
  requestBody?: JsonValue;
  output_schema?: JsonValue;

  /** Fail-closed verification state for this catalog result. */
  verification_status: VerificationStatus;

  /** Evidence supporting the verification state. */
  verification: CatalogVerification;

  /** Eligibility, policy, and execution-readiness restrictions. */
  execution_restrictions: ExecutionRestrictions;

  /** Usage examples with sample parameters */
  examples?: ToolExamples;

  /** Historical execution performance statistics */
  stats?: ToolStats;

  /** Structured rule-level billing metadata when available */
  billing_rule?: BillingRule;

  /** Pre-call cost estimate in credits, when available */
  expected_cost?: string | number;

  /** Relevance score for the search query (0.0 - 1.0, higher = better match) */
  final_score?: number;

  /** Human-readable explanation of why this tool was recommended (Discover results only) */
  why_recommended?: string;

  /** Whether this tool has execution history; not a guarantee of correctness or reliability */
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
  error_message?: string | null;
  contract_warnings?: string[];
  contract_features?: string[];
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
  remaining_credits?: number | null;

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
  /** End-user identity for provider OAuth; use the same value for Probe and Call. */
  sub_user_id?: string;
  /**
   * The search_id from the search that returned this tool.
   * Links the execution to the original search for analytics and billing.
   */
  search_id: string;

  /** Session identifier for tracking user sessions. */
  session_id?: string;

  /** Model that selected and parameterized this capability call. */
  model?: string;

  /**
   * Key-value pairs of parameters to pass to the tool.
   * Must match the parameter schema from the tool's definition.
   */
  parameters: Record<string, unknown>;

  /**
   * Automatic inline limit measured in UTF-8 bytes. When `respond_with` is
   * omitted, oversized results use the overflow envelope. Explicit `full`
   * takes precedence over a finite value and either returns complete inline
   * data or fails with `response_too_large` at the platform hard limit.
   * Minimum: -1 (`-1` means no limit).
   * @default 20480 (20KB)
   */
  max_response_size?: number;

  /** Server-side result projection. Omit for compatibility auto-delivery; explicit `full` forces complete inline data. */
  respond_with?: 'full' | 'summary' | `fields:${string}`;
}

/**
 * Result data when the response fits within max_response_size.
 */
export interface ExecuteResultData {
  /** Projection markers belong to the projected result variants, not full data. */
  respond_with?: 'full';
  /** The actual result data from the tool execution */
  data: unknown;
}

/**
 * Overflow result used by compatibility auto-delivery or an oversized fields projection.
 * A successful explicit full response never uses this shape.
 * Provides truncated content and a URL to download the full result.
 */
export interface ExecuteResultTruncated {
  /** Explanation message about the truncation */
  message?: string;

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

/** Overflow envelope returned when a fields projection still exceeds the size limit. */
export interface ExecuteResultProjectedOverflow extends ExecuteResultTruncated {
  respond_with: `fields:${string}`;
}

/** Shared metadata for summary delivery, including preserved fallback payloads. */
export interface ExecuteResultSummaryBase {
  respond_with: 'summary';
  content_schema?: Record<string, unknown>;
  summary?: {
    size_bytes?: number;
    row_count?: number;
    fields?: string[];
    [key: string]: unknown;
  };
  data?: unknown;
  truncated_content?: string;
  full_content_file_url?: string;
  message?: string;
}

/**
 * Summary mode preserves at least one usable payload: statistics, lossless data,
 * or a preview with its download URL. These payloads may coexist. Check success
 * and field availability before consuming them; a summary need not have a URL.
 */
export type ExecuteResultSummary = ExecuteResultSummaryBase &
  (
    | { summary: NonNullable<ExecuteResultSummaryBase['summary']> }
    | { data: unknown }
    | { truncated_content: string; full_content_file_url: string }
  );

/** Selected result fields returned by a `fields:<JSONPath,...>` projection. */
export interface ExecuteResultFields {
  respond_with: `fields:${string}`;
  data: unknown;
}

/**
 * Provider-owned object in an unprojected/full response.
 * Projection markers are reserved at the result-envelope level. Provider data
 * may contain arbitrary keys (including respond_with) inside its data payload.
 */
export interface ExecuteResultRawObject {
  [key: string]: unknown;
  respond_with?: 'full';
}

/**
 * Union type for execution results (either full data or truncated).
 */
export type ExecuteResult =
  | ExecuteResultRawObject
  | ExecuteResultData
  | ExecuteResultTruncated
  | ExecuteResultProjectedOverflow
  | ExecuteResultSummary
  | ExecuteResultFields
  | unknown[]
  | string
  | number
  | boolean
  | null;

/**
 * Response from the Execute Tool API.
 */
export interface ValidationIssue {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: JsonValue;
  ctx?: Record<string, JsonValue>;
}

export interface ExecuteResponse {
  details?: ValidationIssue[];
  /** Unique identifier for this execution record */
  execution_id: string;

  /** The tool that was executed */
  tool_id?: string;

  /** The parameters that were passed to the tool */
  parameters?: Record<string, unknown>;

  /**
   * The execution result.
   * Contains either `data` (if within size limit) or truncation info.
   */
  result?: ExecuteResult;

  /** Whether the execution completed successfully */
  success: boolean;

  /** Recovery guidance when execution failed; added client-side when absent. */
  next_action?: NextAction;

  /** Stable machine-readable error code when execution failed. */
  error_code?: string | null;

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
  remaining_credits?: number | null;

  /** Timestamp of execution (ISO 8601 format) */
  created_at?: string;
}

export type ProbeCheck = 'schema' | 'quote' | 'coverage' | 'sample';
export type ProbeLiveBudget = 'none' | 'metadata' | 'sampled';

export interface ProbeRequest {
  /** End-user identity for provider OAuth readiness checks. */
  sub_user_id?: string;
  parameters?: Record<string, unknown>;
  checks?: ProbeCheck[];
  live_budget?: ProbeLiveBudget;
}

export interface ProbeSchemaViolation {
  param?: string | null;
  type: string;
  message: string;
}

export interface ProbeSchemaResult {
  valid: boolean;
  violations?: ProbeSchemaViolation[] | null;
  note?: string | null;
}

export interface ProbeQuoteResult {
  estimate_credits?: number | null;
  currency: 'credits';
  exact: boolean;
  basis?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface ProbeUnknownResult {
  verdict: 'unknown';
  reason: string;
}

export interface ProbeRecoveryAdvice {
  missing_fields: string[];
  safe_fixes: string[];
  retryable: boolean;
  next_action: 'execute' | 'inspect' | 'probe' | 'authorize' | 'confirm_budget' | 'switch_provider' | 'retry';
  provider_fallback: boolean;
}

export interface ProbeResponse {
  verification_status: VerificationStatus;
  verification: CatalogVerification;
  execution_restrictions: ExecutionRestrictions;
  recovery: ProbeRecoveryAdvice;
  exists?: boolean;
  executable?: boolean;
  status?: number;
  reason?:
    | 'tool_unavailable'
    | 'tool_disabled'
    | 'realtime_unavailable'
    | 'region_restricted'
    | 'insufficient_scope'
    | 'delegation_budget_not_supported'
    | 'oauth2_signin_required';
  contract_features?: string[];
  schema?: ProbeSchemaResult;
  quote?: ProbeQuoteResult;
  coverage?: ProbeUnknownResult;
  sample?: ProbeUnknownResult;
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
  remaining_credits: number | null;
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

  /** API base URL. Overrides QVERIS_BASE_URL and the built-in default. */
  baseUrl?: string;

  /** Default request timeout in milliseconds */
  timeoutMs?: number;

  /**
   * Max automatic retries for rate-limited (429) / transient (503) responses.
   * Honors `Retry-After`, otherwise backs off exponentially with jitter.
   * Defaults to 3; set to 0 to disable.
   */
  maxRetries?: number;
}

/**
 * Error response from the Qveris API.
 */
export type ApiOperation = 'discover' | 'inspect' | 'probe' | 'call' | 'credits' | 'usage_history' | 'credits_ledger';
export type ApiErrorType = 'http_error' | 'invalid_json' | 'invalid_response' | 'timeout' | 'network_error';

export interface NextAction {
  action: string;
  automatic: boolean;
  requires_user: boolean;
  missing_fields: string[];
  reason?: string;
}

export interface ApiObservability {
  source: 'qveris_api';
  operation: ApiOperation;
  method: 'GET' | 'POST';
  endpoint: string;
  url: string;
  query_params?: Record<string, string>;
  timeout_ms: number;
  http_status?: number;
  request_id?: string;
  error_type?: ApiErrorType;
}

export interface ApiError {
  /** HTTP status code */
  status: number;

  /** Error message */
  message: string;

  /** Original error details if available */
  details?: unknown;

  /** Request metadata for diagnosing API/provider/tool-chain failures. */
  observability?: ApiObservability;

  /** Lower-level transport or runtime cause when available. */
  cause?: string;

  /** Stable recovery guidance; callers do not need internal contract versions or evidence digests. */
  next_action?: NextAction;
}
