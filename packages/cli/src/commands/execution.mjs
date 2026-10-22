import { resolveApiKey } from "../client/auth.mjs";
import { getExecutionByIdempotencyKey, resolveApiBaseUrl, unwrapApiResponse } from "../client/api.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runExecutionLookup(idempotencyKey, flags) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw new Error("An idempotency key is required.");
  }
  const apiKey = resolveApiKey(flags.apiKey);
  const { baseUrl } = resolveApiBaseUrl({ baseUrlFlag: flags.baseUrl, preferOAuth: apiKey === undefined });
  const spinner = flags.json ? { stop() {} } : createSpinner("Looking up Call outcome...");
  try {
    const result = unwrapApiResponse(
      await getExecutionByIdempotencyKey({
        apiKey,
        baseUrl,
        key: idempotencyKey,
        timeoutMs: (parseInt(flags.timeout, 10) || 30) * 1000,
      }),
    );
    spinner.stop();
    if (flags.json) outputJson(result);
    else console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
