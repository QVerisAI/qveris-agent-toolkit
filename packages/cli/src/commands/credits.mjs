import { resolveApiKey } from "../client/auth.mjs";
import { getCredits, unwrapApiResponse } from "../client/api.mjs";
import { resolveBaseUrl, getSiteUrl } from "../config/region.mjs";
import { bold, dim, cyan, yellow, green } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";

export async function runCredits(flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const { region, baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey });
  const accountUrl = `${getSiteUrl(region, baseUrl)}/account`;

  const spinner = flags.json ? { stop() {} } : createSpinner("Checking credits...");

  try {
    const result = unwrapApiResponse(await getCredits({ apiKey, baseUrl, timeoutMs: 10000 }));
    spinner.stop();

    const credits = result.remaining_credits;

    if (flags.json) {
      outputJson(result);
    } else if (credits !== undefined && credits !== null) {
      console.log(`\n  ${green("\u2713")} Credits remaining: ${bold(yellow(String(credits)))}`);
      printBucket("Daily free", result.daily_free, "remaining", "total");
      printBucket("Invite reward", result.invite_reward, "remaining", "total");
      printBucket("Welcome bonus", result.welcome_bonus, "remaining", "initial");
      printBucket("Purchased", result.purchased, "remaining", "total");
      console.log(`  ${dim("Manage at:")} ${cyan(accountUrl)}\n`);
    } else {
      console.log(`\n  ${dim("Credit balance not available in API response.")}`);
      console.log(`  Check at: ${cyan(accountUrl)}\n`);
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

function printBucket(label, bucket, remainingKey, totalKey) {
  if (!bucket || typeof bucket !== "object") return;
  const remaining = bucket[remainingKey];
  const total = bucket[totalKey];
  if (remaining === undefined && total === undefined) return;
  const parts = [];
  if (remaining !== undefined) parts.push(`remaining ${yellow(String(remaining))}`);
  if (total !== undefined) parts.push(`${dim("of")} ${String(total)}`);
  console.log(`  ${dim(label + ":")} ${parts.join(" ")}`);
}
