import {
  createAuthorizationContextCredentialProvider,
  resolveApiKey,
  resolveAuthorizationContextId,
} from "../client/auth.mjs";
import { reconcileToolExecution, resolveApiBaseUrl, unwrapApiResponse } from "../client/api.mjs";
import { outputJson } from "../output/json.mjs";
import { CliError } from "../errors/handler.mjs";

export async function runReconcileCall(flags) {
  if (typeof flags.idempotencyKey !== "string" || !flags.idempotencyKey.trim()) {
    throw new CliError("API_ERROR", "Usage: qveris reconcile-call --idempotency-key <original-key>");
  }
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const { baseUrl } = resolveApiBaseUrl({ baseUrlFlag: flags.baseUrl, preferOAuth: apiKey === undefined });
  let credentialProvider;
  if (apiKey === undefined) {
    const authorizationContext = await resolveAuthorizationContextId({ apiKey });
    credentialProvider = createAuthorizationContextCredentialProvider({ apiKey, authorizationContext });
  }
  const envelope = await reconcileToolExecution({
    apiKey,
    credentialProvider,
    baseUrl,
    idempotencyKey: flags.idempotencyKey,
    timeoutMs,
  });
  const result = unwrapApiResponse(envelope);
  if (flags.json) {
    outputJson(result);
    return;
  }
  console.log(`Call status: ${result?.status ?? "unknown"}`);
  if (result?.execution_id) console.log(`Execution: ${result.execution_id}`);
  if (result?.execution_state) console.log(`Execution state: ${result.execution_state}`);
  if (result?.settlement_state) console.log(`Settlement: ${result.settlement_state}`);
  if (result?.retry_disposition) console.log(`Retry disposition: ${result.retry_disposition}`);
  if (result?.result_unavailable_reason) console.log(`Result unavailable: ${result.result_unavailable_reason}`);
  if (result?.status === "completed" && result.response !== undefined) {
    console.log("Original Call response:");
    console.log(JSON.stringify(result.response, null, 2));
  }
  if (result?.status === "unavailable") {
    console.log("The original result cannot be recovered. Do not submit a new Call automatically.");
  }
}
