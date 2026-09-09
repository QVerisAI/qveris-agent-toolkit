import {
  createAuthorizationContextCredentialProvider,
  resolveApiKey,
  resolveAuthorizationContextId,
} from "../client/auth.mjs";
import { inspectToolsByIds, resolveApiBaseUrl } from "../client/api.mjs";
import { resolveToolId, getSessionDiscoveryId, readSessionForContext } from "../session/session.mjs";
import { formatInspectResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { CliError } from "../errors/handler.mjs";

export async function runInspect(idsOrIndexes, flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const { baseUrl } = resolveApiBaseUrl({ baseUrlFlag: flags.baseUrl, preferOAuth: apiKey === undefined });
  const numericIndex = idsOrIndexes.some((value) => /^\d+$/.test(value));
  const usesSessionShortcut = numericIndex || !flags.discoveryId;
  let session = null;
  let credentialProvider;
  if (usesSessionShortcut) {
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

  const toolIds = [];
  let discoveryId = flags.discoveryId || null;

  for (const raw of idsOrIndexes) {
    const resolved = resolveToolId(raw, { session });
    if (/^\d+$/.test(raw) && !resolved.fromSession) {
      throw new CliError("SESSION_EXPIRED", "No matching discovery index. Run 'qveris discover' first.");
    }
    toolIds.push(resolved.toolId);
    if (resolved.fromSession && resolved.discoveryId && !discoveryId) {
      discoveryId = resolved.discoveryId;
    }
  }

  if (!discoveryId) discoveryId = getSessionDiscoveryId({ session });

  const spinner = flags.json ? { stop() {} } : createSpinner("Inspecting tools...");

  try {
    const result = await inspectToolsByIds({
      apiKey,
      credentialProvider,
      baseUrl,
      toolIds,
      discoveryId,
      timeoutMs,
    });

    spinner.stop();

    if (flags.json) {
      outputJson(result);
    } else {
      console.log(formatInspectResult(result));
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
