import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const pluginManifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
const expectedRepositoryUrl = "https://github.com/QVerisAI/qveris-agent-toolkit";
if (packageJson.repository?.url !== expectedRepositoryUrl) {
  fail("package.json repository.url must match the public provenance repository:", [
    `expected: ${expectedRepositoryUrl}`,
    `received: ${packageJson.repository?.url ?? packageJson.repository}`,
  ]);
}
const extensions = packageJson.openclaw?.extensions;
if (!Array.isArray(extensions) || !extensions.includes("./dist/index.js")) {
  fail("package.json openclaw.extensions must include the compiled runtime entry:", ['expected "./dist/index.js"']);
}
if (extensions.some((entry) => typeof entry === "string" && /\.tsx?$/.test(entry))) {
  fail("package.json openclaw.extensions must not point at TypeScript source entries for npm packages:", extensions);
}

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
const networkSendPattern = /\b(?:globalThis\.)?fetch\s*\(|\bhttps?\.request\s*\(|\bXMLHttpRequest\b|\baxios\s*\./;

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exit(1);
}

// On Windows npm/npx are .cmd shims that can only be spawned through a shell.
const shell = process.platform === "win32";

execFileSync("npm", ["run", "build"], { stdio: "inherit", shell });

const runtimeModule = await import(new URL("../dist/index.js", import.meta.url));
const runtimePlugin = runtimeModule.default;
const registrations = [];
runtimePlugin.register({
  registerTool(_factory, options) {
    registrations.push(options);
  },
});

if (pluginManifest.id !== runtimePlugin.id) {
  fail("openclaw.plugin.json id must match the compiled runtime plugin id:", [
    `manifest: ${pluginManifest.id}`,
    `runtime: ${runtimePlugin.id}`,
  ]);
}
if (pluginManifest.name !== runtimePlugin.name || pluginManifest.description !== runtimePlugin.description) {
  fail("openclaw.plugin.json presentation metadata must match the compiled runtime plugin:", [
    `manifest name/description: ${pluginManifest.name} / ${pluginManifest.description}`,
    `runtime name/description: ${runtimePlugin.name} / ${runtimePlugin.description}`,
  ]);
}
if (pluginManifest.version !== packageJson.version) {
  fail("openclaw.plugin.json version must match package.json:", [
    `manifest: ${pluginManifest.version}`,
    `package: ${packageJson.version}`,
  ]);
}
if (pluginManifest.activation?.onStartup !== true) {
  fail("openclaw.plugin.json must explicitly activate this required-tool plugin at Gateway startup");
}
if (registrations.length !== 1 || !Array.isArray(registrations[0]?.names)) {
  fail("Compiled runtime must make exactly one named tool-factory registration");
}

const declaredToolNames = pluginManifest.contracts?.tools;
const registeredToolNames = registrations[0]?.names;
if (!Array.isArray(declaredToolNames) || JSON.stringify(declaredToolNames) !== JSON.stringify(registeredToolNames)) {
  fail("openclaw.plugin.json contracts.tools must exactly match the compiled runtime registration:", [
    `manifest: ${JSON.stringify(declaredToolNames)}`,
    `runtime: ${JSON.stringify(registeredToolNames)}`,
  ]);
}
if (new Set(declaredToolNames).size !== declaredToolNames.length) {
  fail("openclaw.plugin.json contracts.tools must not contain duplicate names");
}

const metadataToolNames = Object.keys(pluginManifest.toolMetadata ?? {}).sort();
if (JSON.stringify(metadataToolNames) !== JSON.stringify([...declaredToolNames].sort())) {
  fail("openclaw.plugin.json toolMetadata must cover exactly the declared tools:", [
    `contracts.tools: ${JSON.stringify([...declaredToolNames].sort())}`,
    `toolMetadata: ${JSON.stringify(metadataToolNames)}`,
  ]);
}
for (const toolName of declaredToolNames) {
  const metadata = pluginManifest.toolMetadata[toolName];
  const hasQverisAuthSignal = metadata.authSignals?.some((signal) => signal?.provider === "qveris");
  const hasQverisConfigSignal = metadata.configSignals?.some(
    (signal) =>
      signal?.rootPath === "plugins.entries.qveris.config" &&
      Array.isArray(signal.required) &&
      signal.required.includes("apiKey"),
  );
  if (!hasQverisAuthSignal || !hasQverisConfigSignal) {
    fail(`openclaw.plugin.json toolMetadata.${toolName} must declare QVeris auth and config signals`);
  }
}
for (const replaySafeTool of ["qveris_discover", "qveris_inspect"]) {
  if (pluginManifest.toolMetadata[replaySafeTool]?.replaySafe !== true) {
    fail(`openclaw.plugin.json toolMetadata.${replaySafeTool} must be replaySafe`);
  }
}
if (pluginManifest.toolMetadata.qveris_call?.replaySafe === true) {
  fail("Paid qveris_call must never be declared replaySafe");
}

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  shell,
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
