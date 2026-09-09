import {
  createAuthorizationContextCredentialProvider,
  resolveApiKey,
  resolveAuthorizationContextId,
} from "../client/auth.mjs";
import { probeTool, resolveApiBaseUrl } from "../client/api.mjs";
import { readSessionForContext, resolveToolId } from "../session/session.mjs";
import { resolveParams } from "../utils/params.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { CliError } from "../errors/handler.mjs";

const ALLOWED_CHECKS = new Set(["schema", "quote", "coverage", "sample"]);
const ALLOWED_BUDGETS = new Set(["none", "metadata", "sampled"]);

export function resolveProbeChecks(value) {
  const checks =
    value === undefined
      ? ["schema"]
      : value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  if (checks.length === 0 || checks.some((check) => !ALLOWED_CHECKS.has(check))) {
    throw new CliError("API_ERROR", "Invalid --checks: use schema,quote,coverage,sample");
  }
  return [...new Set(checks)];
}

export async function runProbe(idOrIndex, flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const { baseUrl } = resolveApiBaseUrl({ baseUrlFlag: flags.baseUrl, preferOAuth: apiKey === undefined });
  const numericIndex = /^\d+$/.test(idOrIndex);
  let session = null;
  let credentialProvider;
  if (numericIndex) {
    const authorizationContext = await resolveAuthorizationContextId({ apiKey });
    credentialProvider = createAuthorizationContextCredentialProvider({ apiKey, authorizationContext });
    const resolvedSession = readSessionForContext({ baseUrl, authorizationContext });
    if (resolvedSession.status === "context_mismatch") {
      throw new CliError(
        "SESSION_EXPIRED",
        "Stored discovery belongs to another API endpoint or authorization context. Run 'qveris discover' again.",
      );
    }
    session = resolvedSession.session;
  }
  const resolved = resolveToolId(idOrIndex, { session });
  if (numericIndex && !resolved.fromSession) {
    throw new CliError("SESSION_EXPIRED", "No matching discovery index. Run 'qveris discover' first.");
  }
  const toolId = resolved.toolId;
  const parameters = resolveParams(flags.params || "{}");
  const checks = resolveProbeChecks(flags.checks);
  const liveBudget = flags.liveBudget ?? "none";
  if (!ALLOWED_BUDGETS.has(liveBudget)) {
    throw new CliError("API_ERROR", "Invalid --live-budget: use none, metadata, or sampled");
  }

  const spinner = flags.json ? { stop() {} } : createSpinner("Probing tool...");
  try {
    const result = await probeTool({
      apiKey,
      credentialProvider,
      baseUrl,
      toolId,
      parameters,
      checks,
      liveBudget,
      timeoutMs,
    });
    spinner.stop();
    if (flags.json) outputJson(result);
    else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
