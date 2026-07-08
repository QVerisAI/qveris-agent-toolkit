import { runPreflight } from "../client/preflight.mjs";
import { bold, green, red, yellow, dim } from "../output/colors.mjs";

const ICON = { ok: green("✓"), warn: yellow("!"), fail: red("✘") };

export async function runDoctor(flags) {
  const { checks, ok, contractVersion } = await runPreflight({
    apiKeyFlag: flags.apiKey,
    baseUrlFlag: flags.baseUrl,
  });

  if (flags.json) {
    console.log(JSON.stringify({ ok, contract_version: contractVersion, checks }, null, 2));
    if (!ok) process.exitCode = 1;
    return;
  }

  console.log(`\n  ${bold("QVeris CLI Doctor")}\n`);
  for (const c of checks) {
    console.log(`  ${ICON[c.status] || "-"} ${c.detail}`);
    if (c.hint && c.status !== "ok") console.log(`     ${dim(c.hint)}`);
  }

  console.log();
  if (ok) {
    console.log(`  ${green("All checks passed.")}\n`);
  } else {
    console.log(`  ${red("Some checks failed.")} Fix the items above and re-run ${bold("qveris doctor")}.\n`);
    process.exitCode = 1;
  }
}
