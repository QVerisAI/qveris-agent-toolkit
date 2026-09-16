export const EX_OK = 0;
export const EX_GENERAL = 1;
export const EX_USAGE = 2;
export const EX_UNAVAILABLE = 69;
export const EX_TEMPFAIL = 75;
export const EX_NOPERM = 77;
export const EX_CONFIG = 78;

export const ERROR_CODES = {
  AUTH_MISSING_KEY: {
    message: "No API key configured",
    hint: "Run 'qveris auth login', 'qveris login', or set QVERIS_API_KEY",
    exit: EX_CONFIG,
  },
  NODE_UNSUPPORTED: {
    message: "Unsupported Node.js version",
    hint: "Upgrade to Node.js 18 or newer",
    exit: EX_CONFIG,
  },
  BASE_URL_INVALID: {
    message: "Invalid API base URL",
    hint: "Set QVERIS_BASE_URL to the complete HTTP(S) API root supplied by your QVeris service",
    exit: EX_CONFIG,
  },
  AUTH_INVALID_KEY: {
    message: "Authentication failed",
    hint: "Check the API key for the configured endpoint",
    exit: EX_NOPERM,
  },
  AUTH_OAUTH_FAILED: {
    message: "OAuth authentication failed",
    hint: "Run 'qveris auth login' again",
    exit: EX_NOPERM,
  },
  PERMISSION_DENIED: {
    message: "Permission denied",
    hint: "Confirm the account, API key, OAuth scopes, and selected capability permissions for the configured endpoint",
    exit: EX_NOPERM,
  },
  NET_TIMEOUT: {
    message: "Request timed out",
    hint: "Check connectivity or increase --timeout",
    exit: EX_TEMPFAIL,
  },
  API_ERROR: {
    message: "API error",
    hint: null,
    exit: EX_GENERAL,
  },
  PARAMS_INVALID_JSON: {
    message: "Invalid JSON in --params",
    hint: "Check JSON syntax in --params value, or pass a file with --params @params.json",
    exit: EX_USAGE,
  },
  CONTEXT_INVALID: {
    message: "Invalid service/task context",
    hint: "Copy a fresh v1 JSON template from the installation page",
    exit: EX_USAGE,
  },
  CONTEXT_EXPIRED: {
    message: "Service/task context expired",
    hint: "Refresh current discovery; safe task intent and public IDs can be retained",
    exit: EX_USAGE,
  },
  CONTEXT_UNSUPPORTED: {
    message: "Unsupported service/task context version",
    hint: "Upgrade the CLI or use a template whose minimum version and required capabilities are supported",
    exit: EX_USAGE,
  },
  CONTEXT_UNSAFE: {
    message: "Unsafe service/task context",
    hint: "Remove private data and credentials, rotate any exposed secret, and copy a fresh public-ID-only template",
    exit: EX_USAGE,
  },
  CONTEXT_REDISCOVERY_FAILED: {
    message: "Context could not be confirmed by current discovery",
    hint: "Select a returned current candidate or broaden discovery; do not force the old tool ID",
    exit: EX_UNAVAILABLE,
  },
  CONTEXT_INSPECT_FAILED: {
    message: "Context tool could not be confirmed by current inspection",
    hint: "Retry current discovery/inspection or select a returned fallback candidate",
    exit: EX_UNAVAILABLE,
  },
  CONTEXT_PROBE_FAILED: {
    message: "Context parameters failed current preflight validation",
    hint: "Review the latest schema, correct --params, and retry; request a quote only when policy requires it",
    exit: EX_USAGE,
  },
  CONTEXT_QUOTE_REQUIRED: {
    message: "A current quote is required by execution policy",
    hint: "Refresh the quote, remove the explicit quote/budget requirement, or select another provider",
    exit: EX_UNAVAILABLE,
  },
  CONTEXT_BUDGET_EXCEEDED: {
    message: "Current quote exceeds the execution budget",
    hint: "Increase --max-credits or select a lower-cost provider",
    exit: EX_NOPERM,
  },
  CONTEXT_BUDGET_UNVERIFIED: {
    message: "The execution budget cannot be guaranteed",
    hint: "Obtain an exact quote, remove --max-credits, or select a provider with a provable upper bound",
    exit: EX_NOPERM,
  },
  CONTEXT_EXECUTION_BLOCKED: {
    message: "Execution is blocked by safety policy",
    hint: "Review permissions, region constraints, side effects, and idempotency before retrying",
    exit: EX_NOPERM,
  },
  INIT_PARAMS_REQUIRED: {
    message: "Init could not infer safe parameters for the selected capability",
    hint: "Run 'qveris inspect 1' to review required params, then rerun 'qveris init --resume --params <json>'",
    exit: EX_USAGE,
  },
  TOOL_CALL_FAILED: {
    message: "Capability call failed",
    hint: "Review the error, adjust --params, then rerun 'qveris init --resume --params <json>'",
    exit: EX_UNAVAILABLE,
  },
  PROVIDER_FAILURE: {
    message: "Remote provider failed",
    hint: "Try another discovered capability with 'qveris inspect 2' and 'qveris call 2', or rerun discovery with a broader query",
    exit: EX_UNAVAILABLE,
  },
  TOOL_NOT_FOUND: {
    message: "Tool not found",
    hint: "Run 'qveris discover' to find available tools",
    exit: EX_USAGE,
  },
  RATE_LIMITED: {
    message: "Rate limited",
    hint: "Wait and retry, or upgrade your plan",
    exit: EX_TEMPFAIL,
  },
  CREDITS_INSUFFICIENT: {
    message: "Insufficient credits",
    hint: "Purchase credits for the configured endpoint, then confirm balance with 'qveris credits'",
    exit: EX_NOPERM,
  },
  SESSION_EXPIRED: {
    message: "Session expired",
    hint: "Run 'qveris discover' or 'qveris init' to start a new session",
    exit: EX_USAGE,
  },
};
