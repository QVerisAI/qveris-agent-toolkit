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
    hint: "Run 'qveris login' or set QVERIS_API_KEY",
    exit: EX_CONFIG,
  },
  AUTH_INVALID_KEY: {
    message: "Authentication failed",
    hint: "Check your key at https://qveris.ai/account",
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
    hint: "Purchase credits at https://qveris.ai/pricing, then confirm balance with 'qveris credits'",
    exit: EX_NOPERM,
  },
  SESSION_EXPIRED: {
    message: "Session expired",
    hint: "Run 'qveris discover' or 'qveris init' to start a new session",
    exit: EX_USAGE,
  },
};
