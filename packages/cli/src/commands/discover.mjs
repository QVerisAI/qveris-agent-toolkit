import { resolveApiKey } from "../client/auth.mjs";
import { discoverTools } from "../client/api.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { writeSession } from "../session/session.mjs";
import { formatDiscoverResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runDiscover(query, flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const { region, baseUrl: resolvedBaseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey });
  const limit = parseInt(flags.limit, 10) || 5;
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;

  const spinner = flags.json ? { stop() {} } : createSpinner("Discovering capabilities...");

  try {
    const result = await discoverTools({
      apiKey,
      baseUrl: resolvedBaseUrl,
      query,
      limit,
      timeoutMs,
    });

    spinner.stop();

    // Store richer session data for index resolution
    const tools = result.results ?? [];
    writeSession({
      discoveryId: result.search_id,
      query,
      region,
      baseUrl: resolvedBaseUrl,
      results: tools.map((t, i) => ({
        index: i + 1,
        tool_id: t.tool_id,
        name: t.name,
        provider_name: t.provider_name,
      })),
    });

    if (flags.json) {
      outputJson(result);
    } else {
      console.log(formatDiscoverResult(result));
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
