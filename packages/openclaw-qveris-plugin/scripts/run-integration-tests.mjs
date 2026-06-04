import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

if (process.env.QVERIS_RUN_INTEGRATION !== "1") {
  console.error("Integration tests are disabled by default.");
  console.error("Set QVERIS_RUN_INTEGRATION=1 to run tests under integration/.");
  process.exit(1);
}

const integrationDir = path.resolve("integration");

function listTests(dir) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...listTests(fullPath));
    } else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      tests.push(fullPath);
    }
  }
  return tests;
}

const tests = listTests(integrationDir);
if (tests.length === 0) {
  console.log("No integration tests are defined.");
  process.exit(0);
}

const result = spawnSync("npx", ["vitest", "run", ...tests], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
