import { DEFAULT_BASE_URL } from "./defaults.mjs";
import { CliError } from "../errors/handler.mjs";

/**
 * Get the account site associated with a resolved API URL.
 * Unknown and private endpoints fall back to the public account site.
 * @param {string} baseUrl
 * @returns {string}
 */
export function getSiteUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (hostname === "qveris.cn" || hostname.endsWith(".qveris.cn")) return "https://qveris.cn";
  } catch {
    // resolveBaseUrl validates URLs before this helper is called.
  }
  return "https://qveris.ai";
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

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CliError("BASE_URL_INVALID", `Invalid API base URL: ${value}`);
  }

  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) {
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
 * API keys never influence endpoint selection. This keeps explicit test and
 * private-deployment overrides from being redirected to another endpoint.
 *
 * @param {{ baseUrlFlag?: string }} options
 * @returns {{ baseUrl: string, source: string }}
 */
export function resolveBaseUrl({ baseUrlFlag } = {}) {
  if (baseUrlFlag !== undefined && baseUrlFlag !== null) {
    return { baseUrl: normalizeBaseUrl(baseUrlFlag), source: "flag" };
  }
  if (Object.prototype.hasOwnProperty.call(process.env, "QVERIS_BASE_URL")) {
    return {
      baseUrl: normalizeBaseUrl(process.env.QVERIS_BASE_URL),
      source: "env (QVERIS_BASE_URL)",
    };
  }
  return { baseUrl: DEFAULT_BASE_URL, source: "default" };
}
