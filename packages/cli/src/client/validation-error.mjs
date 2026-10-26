import { CliError } from "../errors/handler.mjs";
import { ERROR_CODES } from "../errors/codes.mjs";
import { getSiteUrl } from "../config/endpoint.mjs";

// Validation is read-only. A failed probe does not prove a credential is invalid.
// Do not echo remote response bodies: they can contain credentials or HTML.
export function validationError(error, context = {}) {
  let code = error?.code;
  if (error?.status >= 500) code = "SERVICE_UNAVAILABLE";
  else if (error?.name === "AbortError") code = "NET_TIMEOUT";
  else if (error instanceof TypeError || error?.code === "ECONNRESET" || error?.code === "ENOTFOUND") {
    code = "NET_CONNECTION";
  }
  if (!ERROR_CODES[code]) code = "API_ERROR";
  const result = new CliError(code);
  if (Number.isInteger(error?.status)) result.status = error.status;
  result.retryable = ["RATE_LIMITED", "NET_TIMEOUT", "NET_CONNECTION", "SERVICE_UNAVAILABLE"].includes(code);
  result.action = result.retryable
    ? "retry_validation"
    : code === "API_ERROR"
      ? "review_api_response"
      : code === "CREDITS_INSUFFICIENT"
        ? "review_credits"
        : "review_credentials_or_access";
  if (context.endpoint) {
    const site = getSiteUrl(context.endpoint);
    if (code === "AUTH_INVALID_KEY") result.hint = `Check your key at ${site}/account`;
    if (code === "PERMISSION_DENIED") result.hint = `Confirm account and capability permissions at ${site}/account`;
    if (code === "CREDITS_INSUFFICIENT") {
      result.hint = `Purchase credits at ${site}/pricing, then confirm balance with 'qveris credits'`;
    }
  }
  if (code === "RATE_LIMITED") result.hint = "Wait for the rate limit to reset, then retry validation";
  if (code === "NET_TIMEOUT") result.hint = "Check the endpoint and connectivity, then retry validation";
  result.credentialContext = context;
  return result;
}
