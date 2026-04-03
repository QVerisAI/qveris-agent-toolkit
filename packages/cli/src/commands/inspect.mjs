import { resolveApiKey } from "../client/auth.mjs";
import { inspectToolsByIds } from "../client/api.mjs";
import { resolveToolId, getSessionDiscoveryId } from "../session/session.mjs";
import { formatInspectResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runInspect(idsOrIndexes, flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;

  const toolIds = [];
  let discoveryId = flags.discoveryId || null;

  for (const raw of idsOrIndexes) {
    const resolved = resolveToolId(raw);
    toolIds.push(resolved.toolId);
    if (resolved.fromSession && resolved.discoveryId && !discoveryId) {
      discoveryId = resolved.discoveryId;
    }
  }

  if (!discoveryId) discoveryId = getSessionDiscoveryId();

  const spinner = flags.json ? { stop() {} } : createSpinner("Inspecting tools...");

  try {
    const result = await inspectToolsByIds({
      apiKey,
      baseUrl: flags.baseUrl,
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
