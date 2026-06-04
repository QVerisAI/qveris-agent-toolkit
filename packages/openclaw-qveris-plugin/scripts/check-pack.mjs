import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const requiredFiles = new Set([
  "README.md",
  "dist/index.js",
  "dist/src/config.js",
  "dist/src/qveris-cache.js",
  "dist/src/qveris-client.js",
  "dist/src/qveris-errors.js",
  "dist/src/qveris-materialization.js",
  "dist/src/qveris-tools.js",
  "index.ts",
  "openclaw.plugin.json",
  "package.json",
  "src/config.ts",
  "src/qveris-cache.ts",
  "src/qveris-client.ts",
  "src/qveris-errors.ts",
  "src/qveris-materialization.ts",
  "src/qveris-tools.ts",
]);

const forbiddenPatterns = [
  { label: "test source", pattern: /(^|\/)(?:__tests__|__mocks__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/ },
  { label: "test fixture", pattern: /(^|\/)(?:fixtures?|testdata)(?:\/|$)/i },
  { label: "integration test", pattern: /(^|\/)integration(?:\/|$)/i },
  { label: "test config", pattern: /(^|\/)(?:vitest|jest|playwright)\.config\./i },
  { label: "coverage output", pattern: /(^|\/)(?:coverage|\.nyc_output)(?:\/|$)|\.lcov$/i },
  { label: "repo helper script", pattern: /^scripts\// },
  { label: "local cache", pattern: /(^|\/)(?:\.cache|\.tmp|\.temp|tmp)(?:\/|$)/i },
  { label: "packed tarball", pattern: /\.tgz$/i },
];

const envAccessPattern = /\b(?:process\.env|Deno\.env|Bun\.env|import\.meta\.env)\b/;
const networkSendPattern =
  /\b(?:globalThis\.)?fetch\s*\(|\bhttps?\.request\s*\(|\bXMLHttpRequest\b|\baxios\s*\./;

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exit(1);
}

execFileSync("npm", ["run", "build"], { stdio: "inherit" });

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const [pack] = JSON.parse(raw);
const files = pack.files.map((entry) => entry.path.replace(/^package\//, "")).sort();

const missingRequired = [...requiredFiles].filter((file) => !files.includes(file));
if (missingRequired.length > 0) {
  fail("Required runtime files are missing from the npm package:", missingRequired);
}

const forbidden = [];
for (const file of files) {
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(file)) {
      forbidden.push(`${file} (${label})`);
    }
  }
}

if (forbidden.length > 0) {
  fail("Forbidden development or test files would be published:", forbidden);
}

const riskyFiles = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (envAccessPattern.test(text) && networkSendPattern.test(text)) {
    riskyFiles.push(file);
  }
}

if (riskyFiles.length > 0) {
  fail("Packed files combine environment-variable access with network sends:", riskyFiles);
}

console.log(`Pack check OK: ${files.length} files`);
