import { DEFAULT_BASE_URL } from "./defaults.mjs";
import { CliError } from "../errors/handler.mjs";

/**
 * Get the account site associated with a resolved API URL.
 * Public API subdomains map to their canonical sites. Custom endpoints keep
 * their own origin so recovery links never cross into an unrelated service.
 * @param {string} baseUrl
 * @returns {string}
 */
export function getSiteUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const { hostname } = url;
    if (hostname === "qveris.cn" || hostname.endsWith(".qveris.cn")) return "https://qveris.cn";
    if (hostname === "qveris.ai" || hostname.endsWith(".qveris.ai")) return "https://qveris.ai";
    return url.origin;
  } catch {
    // resolveBaseUrl validates URLs before this helper is called.
    return new URL(DEFAULT_BASE_URL).origin;
  }
}

/**
 * Validate and normalize a user-supplied API base URL.
 * @param {string} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CliError("BASE_URL_INVALID", "Invalid API base URL: expected a non-empty HTTP(S) URL");
  }

  const candidate = value.trim();
  if (!/^https?:\/\/[^/?#\s\\]/i.test(candidate) || /\s/.test(candidate) || candidate.includes("\\")) {
    throw new CliError("BASE_URL_INVALID", "Invalid API base URL: expected a valid HTTP(S) URL");
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new CliError("BASE_URL_INVALID", `Invalid API base URL: ${value}`);
  }

  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    url.username ||
    url.password ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    throw new CliError(
      "BASE_URL_INVALID",
      "Invalid API base URL: use an HTTP(S) URL without credentials, query parameters, or fragments",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/**
 * Resolve the base URL for the QVeris API.
 *
 * Priority: --base-url flag > QVERIS_BASE_URL env > built-in default.
 *
 * API keys never influence endpoint selection. This keeps explicit endpoint
 * overrides from being redirected to another service.
 *
 * @param {{ baseUrlFlag?: string }} options
 * @returns {{ baseUrl: string, source: string }}
 */
export function resolveBaseUrl({ baseUrlFlag } = {}) {
  if (baseUrlFlag !== undefined && baseUrlFlag !== null) {
    return { baseUrl: normalizeBaseUrl(baseUrlFlag), source: "flag" };
  }
  if (typeof process.env.QVERIS_BASE_URL === "string") {
    return {
      baseUrl: normalizeBaseUrl(process.env.QVERIS_BASE_URL),
      source: "env (QVERIS_BASE_URL)",
    };
  }
  return { baseUrl: DEFAULT_BASE_URL, source: "default" };
}
