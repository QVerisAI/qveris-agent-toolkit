import { resolveApiKey } from "../client/auth.mjs";
import { discoverTools } from "../client/api.mjs";
import { bold, dim, cyan, yellow, green } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runCredits(flags) {
  const apiKey = resolveApiKey(flags.apiKey);

  const spinner = flags.json ? { stop() {} } : createSpinner("Checking credits...");

  try {
    // The backend returns remaining_credits in every /search response
    const result = await discoverTools({ apiKey, baseUrl: flags.baseUrl, query: "credit balance", limit: 1, timeoutMs: 10000 });
    spinner.stop();

    const credits = result.remaining_credits;

    if (flags.json) {
      outputJson({ remaining_credits: credits ?? null });
    } else if (credits !== undefined && credits !== null) {
      console.log(`\n  ${green("\u2713")} Credits remaining: ${bold(yellow(String(credits)))}`);
      console.log(`  ${dim("Manage at:")} ${cyan("https://qveris.ai/account")}\n`);
    } else {
      console.log(`\n  ${dim("Credit balance not available in API response.")}`);
      console.log(`  Check at: ${cyan("https://qveris.ai/account")}\n`);
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
