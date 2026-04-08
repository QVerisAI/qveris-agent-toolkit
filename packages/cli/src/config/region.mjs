/**
 * Region resolution for QVeris API.
 *
 * Priority: --base-url flag > QVERIS_BASE_URL env > QVERIS_REGION env > key prefix auto-detect > default (global)
 *
 * Key prefix convention:
 *   sk-cn-xxx  → cn region  (qveris.cn)
 *   sk-xxx     → global     (qveris.ai)
 */

const REGION_URLS = {
  global: "https://qveris.ai/api/v1",
  cn: "https://qveris.cn/api/v1",
};

const SITE_URLS = {
  global: "https://qveris.ai",
  cn: "https://qveris.cn",
};

/**
 * Get the site URL (not API URL) for a given region.
 * For custom regions, attempts to infer from the base URL domain.
 * @param {string} region
 * @param {string} [baseUrl] - The resolved API base URL (used to infer site for custom regions)
 * @returns {string}
 */
export function getSiteUrl(region, baseUrl) {
  if (region === "custom" && baseUrl) {
    if (baseUrl.includes("qveris.cn")) return SITE_URLS.cn;
    if (baseUrl.includes("qveris.ai")) return SITE_URLS.global;
  }
  return SITE_URLS[region] || SITE_URLS.global;
}

/**
 * Detect region from API key prefix.
 * @param {string} apiKey
 * @returns {"cn"|"global"}
 */
export function detectRegionFromKey(apiKey) {
  if (typeof apiKey === "string" && apiKey.startsWith("sk-cn-")) return "cn";
  return "global";
}

/**
 * Resolve the base URL for the QVeris API.
 *
 * Priority:
 *   1. Explicit base URL (--base-url flag or QVERIS_BASE_URL env)
 *   2. Explicit region (QVERIS_REGION env or config)
 *   3. Auto-detect from API key prefix
 *   4. Default: global (qveris.ai)
 *
 * @param {{ baseUrlFlag?: string, apiKey?: string }} options
 * @returns {{ baseUrl: string, region: string, source: string }}
 */
export function resolveBaseUrl({ baseUrlFlag, apiKey } = {}) {
  // 1. Explicit base URL flag or env var
  if (baseUrlFlag) {
    return { baseUrl: baseUrlFlag.replace(/\/+$/, ""), region: "custom", source: "flag" };
  }
  if (process.env.QVERIS_BASE_URL) {
    return { baseUrl: process.env.QVERIS_BASE_URL.replace(/\/+$/, ""), region: "custom", source: "env (QVERIS_BASE_URL)" };
  }

  // 2. Explicit region env var
  if (process.env.QVERIS_REGION) {
    const region = process.env.QVERIS_REGION.toLowerCase();
    const url = REGION_URLS[region] || REGION_URLS.global;
    return { baseUrl: url, region, source: "env (QVERIS_REGION)" };
  }

  // 3. Auto-detect from API key prefix
  if (apiKey) {
    const region = detectRegionFromKey(apiKey);
    return { baseUrl: REGION_URLS[region], region, source: "auto (key prefix)" };
  }

  // 4. Default
  return { baseUrl: REGION_URLS.global, region: "global", source: "default" };
}

export { REGION_URLS };
