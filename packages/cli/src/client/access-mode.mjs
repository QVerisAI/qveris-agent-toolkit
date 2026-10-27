import { CliError } from "../errors/handler.mjs";

const PUBLIC_OPERATIONS = new Set(["discover", "inspect"]);
const AUTHENTICATION_HEADERS = new Set([
  "authorization",
  "cookie",
  "mcp-session-id",
  "x-qveris-trial-session-token",
  "x-qveris-claim-account-token",
  "x-qveris-trial-csrf",
  "x-qveris-hosted-mcp-context",
  "x-qveris-hosted-mcp-signature",
  "x-qveris-credential-context",
  "x-qveris-credential-signature",
]);

/** Decide access before resolving credentials or sending a request. */
export function resolveAccessMode({
  publicReadOnly = false,
  hasCredentials = false,
  headers,
  hasSessionProof = false,
  operation,
} = {}) {
  if (typeof publicReadOnly !== "boolean") {
    throw new CliError("API_ERROR", "Public read-only access must be explicitly enabled with a boolean option");
  }
  if (!publicReadOnly) return "authenticated";
  if (hasCredentials || hasSessionProof || hasAuthenticationHeader(headers)) {
    throw new CliError("AUTH_PUBLIC_CREDENTIAL_CONFLICT");
  }
  if (!PUBLIC_OPERATIONS.has(operation)) {
    throw new CliError("AUTH_PUBLIC_OPERATION_DENIED");
  }
  return "public-read-only";
}

function hasAuthenticationHeader(headers) {
  if (!headers) return false;
  const names = Array.isArray(headers)
    ? headers.map(([name]) => name)
    : typeof headers.keys === "function"
      ? [...headers.keys()]
      : Object.keys(headers);
  return names.some((name) => AUTHENTICATION_HEADERS.has(name.toLowerCase()));
}
