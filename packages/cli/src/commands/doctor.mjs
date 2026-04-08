import { resolve } from "../config/resolve.mjs";
import { discoverTools } from "../client/api.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { bold, green, red, dim, cyan } from "../output/colors.mjs";

export async function runDoctor(flags) {
  console.log(`\n  ${bold("QVeris CLI Doctor")}\n`);
  let allOk = true;

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major >= 18) {
    console.log(`  ${green("\u2713")} Node.js ${nodeVersion}`);
  } else {
    console.log(`  ${red("\u2718")} Node.js ${nodeVersion} -- requires >=18`);
    allOk = false;
  }

  // Check API key
  const { value: apiKey, source } = resolve("api_key", flags.apiKey);
  if (apiKey && apiKey.trim()) {
    const masked = apiKey.slice(0, 6) + "..." + apiKey.slice(-4);
    console.log(`  ${green("\u2713")} API key configured (${masked} via ${source})`);

    // Show resolved region
    const { baseUrl, region, source: regionSource } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey });
    console.log(`  ${green("\u2713")} Region: ${region} ${dim(`(${regionSource})`)} → ${dim(baseUrl)}`);

    // Test connectivity
    process.stderr.write(`  \u2026 Testing API connectivity...\r`);
    try {
      await discoverTools({ apiKey, baseUrl: flags.baseUrl, query: "test", limit: 1, timeoutMs: 10000 });
      console.log(`  ${green("\u2713")} API connectivity OK                `);
    } catch (err) {
      console.log(`  ${red("\u2718")} API connectivity failed: ${err.message}  `);
      allOk = false;
    }
  } else {
    console.log(`  ${red("\u2718")} No API key configured`);
    console.log(`     Run ${cyan("qveris login")} or set QVERIS_API_KEY`);
    allOk = false;
  }

  console.log();
  if (allOk) {
    console.log(`  ${green("All checks passed.")}\n`);
  } else {
    console.log(`  ${red("Some checks failed.")}\n`);
    process.exitCode = 1;
  }
}
