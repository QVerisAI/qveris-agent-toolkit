// Pure error classification — no external dependencies.

/**
 * Short reminder appended to error results so the model stays in the QVeris tool workflow.
 */
export const QVERIS_WORKFLOW_NOTE =
  "Stay inside the QVeris tool workflow (qveris_discover / qveris_call / qveris_inspect). " +
  "Never call /search, /tools/execute, or /tools/by-ids directly. " +
  "Never reveal QVERIS_API_KEY.";

/** Structured error returned to the model instead of throwing */
export interface QverisErrorResult {
  success: false;
  error_type:
    | "timeout"
    | "http_error"
    | "network_error"
    | "json_parse_error"
    | "rate_limited"
    | "tool_not_discovered";
  status?: number;
  detail: string;
  retry_hint?: string;
  retry_after_seconds?: number;
  recovery_step?: "fix_params" | "simplify" | "switch_tool";
  attempt_number?: number;
  note?: string;
}

/**
 * Classifies a caught error from a QVeris API call into a structured result
 * so the model receives a consistent error format rather than an exception trace.
 */
export function classifyQverisError(err: unknown, opts?: { note?: string }): QverisErrorResult {
  const note = opts?.note ?? QVERIS_WORKFLOW_NOTE;

  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      success: false,
      error_type: "timeout",
      detail: "Request timed out",
      retry_hint: "Increase timeout_seconds or retry with a simpler query.",
      note,
    };
  }

  if (err instanceof Error && err.name === "AbortError") {
    return {
      success: false,
      error_type: "timeout",
      detail: "Request timed out",
      retry_hint: "Increase timeout_seconds or retry with a simpler query.",
      note,
    };
  }

  if (err instanceof Error) {
    const httpMatch = err.message.match(/\((\d{3})\)/);
    if (httpMatch) {
      const status = Number(httpMatch[1]);

      // Rate-limit: parse Retry-After encoded by buildApiError
      if (status === 429) {
        const retryMatch = err.message.match(/\[retry-after:(\d+)]/);
        const waitSeconds = retryMatch ? Number(retryMatch[1]) : 10;
        return {
          success: false,
          error_type: "rate_limited",
          status: 429,
          detail: err.message.replace(/\s*\[retry-after:\d+]/, ""),
          retry_after_seconds: waitSeconds,
          retry_hint: `Rate limited. Wait ${waitSeconds}s before retrying.`,
          note,
        };
      }

      const isClientError = status >= 400 && status < 500;
      return {
        success: false,
        error_type: "http_error",
        status,
        detail: err.message,
        retry_hint: isClientError
          ? "Check tool_id and params_to_tool structure. Make sure tool_id came from qveris_discover."
          : "QVeris service error — retry in a moment.",
        note,
      };
    }

    return {
      success: false,
      error_type: "network_error",
      detail: err.message,
      retry_hint: "Check network connectivity and retry.",
      note,
    };
  }

  return {
    success: false,
    error_type: "network_error",
    detail: String(err),
    retry_hint: "Check network connectivity and retry.",
    note,
  };
}
