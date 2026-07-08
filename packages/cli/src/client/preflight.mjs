import { resolve } from "../config/resolve.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { discoverTools } from "./api.mjs";
import { ERROR_CODES } from "../errors/codes.mjs";

/**
 * OpenAPI contract version the CLI is built against (docs/openapi info.version).
 * A true server-vs-client version comparison depends on the backend exposing a
 * runtime contract version (WonderfulValley/qveris-website#1684); until then we
 * report this and verify the probe response conforms to the expected shape.
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

async function defaultProbe({ apiKey, baseUrl }) {
  // "test" matches the probe query login/whoami use to validate a key.
  return discoverTools({ apiKey, baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
}

/**
 * No-network checks: Node version, API key presence, region resolution.
 * Returns the checks plus the resolved apiKey/baseUrl for callers that continue
 * on to network work (e.g. `qveris init`).
 */
export function localPreflight({ apiKeyFlag, baseUrlFlag, nodeVersion = process.version } = {}) {
  const checks = [nodeCheck(nodeVersion)];

  const { value: apiKey, source } = resolve("api_key", apiKeyFlag);
  if (!apiKey || !apiKey.trim()) {
    checks.push(check("api_key", "fail", ERROR_CODES.AUTH_MISSING_KEY.message, ERROR_CODES.AUTH_MISSING_KEY.hint));
    return { checks, ok: false, apiKey: null, baseUrl: null, region: null };
  }
  checks.push(check("api_key", "ok", `API key configured (${maskKey(apiKey)} via ${source})`));

  const { baseUrl, region, source: regionSource } = resolveBaseUrl({ baseUrlFlag, apiKey });
  checks.push(check("region", "ok", `Region ${region} (${regionSource}) → ${baseUrl}`));

  return { checks, ok: checks.every((c) => c.status !== "fail"), apiKey, baseUrl, region };
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
    const hint = err.hint || (err.code ? ERROR_CODES[err.code]?.hint : null) || null;
    checks.push(check(codeToName(err.code), "fail", err.message, hint));
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
        positive ? null : "Purchase credits at https://qveris.ai/pricing",
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
