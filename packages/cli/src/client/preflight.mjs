import { resolve } from "../config/resolve.mjs";
import { resolveBaseUrl, getSiteUrl } from "../config/endpoint.mjs";
import { discoverTools } from "./api.mjs";
import { ERROR_CODES } from "../errors/codes.mjs";

/**
 * OpenAPI contract version the CLI is built against (docs/openapi info.version).
 * Until the API exposes a runtime contract version, report the bundled version
 * and verify that the probe response conforms to the expected shape.
 */
export const CLI_CONTRACT_VERSION = "2026-05-12";

/** Build a single diagnostic check result. */
function check(name, status, detail, hint = null) {
  return { name, status, detail, hint };
}

function maskKey(key) {
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : "***";
}

/** Node.js version check (>=18). */
export function nodeCheck(nodeVersion = process.version) {
  const major = parseInt(String(nodeVersion).replace(/^v/, ""), 10);
  if (Number.isFinite(major) && major >= 18) {
    return check("node", "ok", `Node.js ${nodeVersion}`);
  }
  return check("node", "fail", `Node.js ${nodeVersion} — requires >=18`, "Upgrade to Node.js 18 or newer");
}

/** Map a thrown CliError code to a friendlier check name. */
function codeToName(code) {
  if (code === "AUTH_INVALID_KEY") return "api_key_valid";
  if (code === "CREDITS_INSUFFICIENT") return "credits";
  return "connectivity";
}

function endpointRecoveryHint(code, baseUrl) {
  const siteUrl = getSiteUrl(baseUrl);
  if (code === "AUTH_INVALID_KEY") return `Check your key at ${siteUrl}/account`;
  if (code === "CREDITS_INSUFFICIENT") {
    return `Purchase credits at ${siteUrl}/pricing, then confirm balance with 'qveris credits'`;
  }
  return null;
}

async function defaultProbe({ apiKey, baseUrl }) {
  // "test" matches the probe query login/whoami use to validate a key.
  return discoverTools({ apiKey, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
}

/**
 * No-network checks: Node version, API key presence, endpoint resolution.
 * Returns the checks plus the resolved apiKey/baseUrl for callers that continue
 * on to network work (e.g. `qveris init`).
 */
export function localPreflight({ apiKeyFlag, baseUrlFlag, nodeVersion = process.version } = {}) {
  const checks = [nodeCheck(nodeVersion)];

  const { value: apiKey, source } = resolve("api_key", apiKeyFlag);
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    checks.push(check("api_key", "fail", ERROR_CODES.AUTH_MISSING_KEY.message, ERROR_CODES.AUTH_MISSING_KEY.hint));
    return { checks, ok: false, apiKey: null, baseUrl: null };
  }
  checks.push(check("api_key", "ok", `API key configured (${maskKey(apiKey)} via ${source})`));

  let endpoint;
  try {
    endpoint = resolveBaseUrl({ baseUrlFlag });
  } catch (err) {
    checks.push(check("endpoint", "fail", err.message, err.hint));
    return { checks, ok: false, apiKey, baseUrl: null };
  }
  const { baseUrl, source: endpointSource } = endpoint;
  checks.push(check("endpoint", "ok", `API endpoint ${baseUrl} (${endpointSource})`));

  return { checks, ok: checks.every((c) => c.status !== "fail"), apiKey, baseUrl };
}

/**
 * Full diagnostics: local checks plus a free `discover` probe that verifies
 * connectivity, API-key validity, credits, and contract-shape conformance.
 * The probe is free (discover is not billed) and injectable for testing.
 *
 * @returns {Promise<{checks: Array, ok: boolean, contractVersion: string}>}
 */
export async function runPreflight({
  apiKeyFlag,
  baseUrlFlag,
  nodeVersion = process.version,
  probe = defaultProbe,
} = {}) {
  const local = localPreflight({ apiKeyFlag, baseUrlFlag, nodeVersion });
  const checks = [...local.checks];

  // Without a key or with a failing local check we cannot probe safely.
  if (!local.apiKey || local.checks.some((c) => c.status === "fail")) {
    return { checks, ok: false, contractVersion: CLI_CONTRACT_VERSION };
  }

  let response;
  try {
    response = await probe({ apiKey: local.apiKey, baseUrl: local.baseUrl });
  } catch (err) {
    // A diagnostic must never crash: anything (even a non-Error) can be thrown.
    const hint =
      endpointRecoveryHint(err?.code, local.baseUrl) ||
      err?.hint ||
      (err?.code ? ERROR_CODES[err.code]?.hint : null) ||
      null;
    checks.push(check(codeToName(err?.code), "fail", err?.message || String(err), hint));
    return { checks, ok: false, contractVersion: CLI_CONTRACT_VERSION };
  }

  checks.push(check("connectivity", "ok", "API reachable — free discover probe, no credits used"));

  if (typeof response?.remaining_credits === "number") {
    const positive = response.remaining_credits > 0;
    checks.push(
      check(
        "credits",
        positive ? "ok" : "warn",
        `${response.remaining_credits} credits remaining`,
        positive ? null : `Purchase credits at ${getSiteUrl(local.baseUrl)}/pricing`,
      ),
    );
  }

  const shapeOk = response && typeof response.search_id === "string" && Array.isArray(response.results);
  checks.push(
    shapeOk
      ? check("contract", "ok", `Response conforms to contract ${CLI_CONTRACT_VERSION}`)
      : check(
          "contract",
          "warn",
          `Unexpected response shape for contract ${CLI_CONTRACT_VERSION}`,
          "Update the CLI: npm install -g @qverisai/cli@latest",
        ),
  );

  return { checks, ok: checks.every((c) => c.status !== "fail"), contractVersion: CLI_CONTRACT_VERSION };
}
