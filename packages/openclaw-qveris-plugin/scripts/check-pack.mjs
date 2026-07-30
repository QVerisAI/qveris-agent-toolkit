import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const pluginManifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
const expectedRepositoryUrl = "https://github.com/QVerisAI/qveris-agent-toolkit";
const minimumOpenClawVersion = "2026.6.11";
const minimumOpenClawRange = `>=${minimumOpenClawVersion}`;
const requiredToolNames = ["qveris_discover", "qveris_call", "qveris_inspect"];
const expectedToolMetadata = Object.fromEntries(
  requiredToolNames.map((toolName) => [
    toolName,
    {
      authSignals: [{ provider: "qveris" }],
      configSignals: [
        {
          rootPath: "plugins.entries.qveris.config",
          required: ["apiKey"],
        },
      ],
      replaySafe: toolName !== "qveris_call",
    },
  ]),
);
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
const openclawCompatibilityValues = {
  "peerDependencies.openclaw": packageJson.peerDependencies?.openclaw,
  "openclaw.compat.pluginApi": packageJson.openclaw?.compat?.pluginApi,
  "openclaw.build.openclawVersion": packageJson.openclaw?.build?.openclawVersion,
  "openclaw.build.pluginSdkVersion": packageJson.openclaw?.build?.pluginSdkVersion,
  "openclaw.install.minHostVersion": packageJson.openclaw?.install?.minHostVersion,
};
const expectedOpenClawCompatibilityValues = {
  "peerDependencies.openclaw": minimumOpenClawRange,
  "openclaw.compat.pluginApi": minimumOpenClawRange,
  "openclaw.build.openclawVersion": minimumOpenClawVersion,
  "openclaw.build.pluginSdkVersion": minimumOpenClawVersion,
  "openclaw.install.minHostVersion": minimumOpenClawRange,
};
const invalidCompatibilityValues = Object.entries(openclawCompatibilityValues).filter(
  ([key, value]) => value !== expectedOpenClawCompatibilityValues[key],
);
if (invalidCompatibilityValues.length > 0) {
  fail("OpenClaw compatibility metadata must keep the verified minimum host aligned:", [
    `expected exact version ${minimumOpenClawVersion} for build metadata`,
    `expected range ${minimumOpenClawRange} for peer, compat, and install metadata`,
    ...invalidCompatibilityValues.map(
      ([key, value]) =>
        `${key}: expected ${JSON.stringify(expectedOpenClawCompatibilityValues[key])}, received ${JSON.stringify(value)}`,
    ),
  ]);
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
const runtimeApi = {
  pluginConfig: { apiKey: "synthetic-compiled-contract-key" },
  registerTool(factory, options) {
    registrations.push({ factory, options });
  },
};
runtimePlugin.register(runtimeApi);

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
if (
  registrations.length !== 1 ||
  typeof registrations[0]?.factory !== "function" ||
  !Array.isArray(registrations[0]?.options?.names)
) {
  fail("Compiled runtime must make exactly one named tool-factory registration");
}

const declaredToolNames = pluginManifest.contracts?.tools;
const registeredToolNames = registrations[0]?.options?.names;
if (JSON.stringify(declaredToolNames) !== JSON.stringify(requiredToolNames)) {
  fail("openclaw.plugin.json contracts.tools must preserve the public QVeris tool contract:", [
    `expected: ${JSON.stringify(requiredToolNames)}`,
    `manifest: ${JSON.stringify(declaredToolNames)}`,
  ]);
}
if (!Array.isArray(declaredToolNames) || JSON.stringify(declaredToolNames) !== JSON.stringify(registeredToolNames)) {
  fail("openclaw.plugin.json contracts.tools must exactly match the compiled runtime registration:", [
    `manifest: ${JSON.stringify(declaredToolNames)}`,
    `runtime: ${JSON.stringify(registeredToolNames)}`,
  ]);
}
if (new Set(declaredToolNames).size !== declaredToolNames.length) {
  fail("openclaw.plugin.json contracts.tools must not contain duplicate names");
}

if (!isDeepStrictEqual(pluginManifest.toolMetadata, expectedToolMetadata)) {
  fail("openclaw.plugin.json toolMetadata must preserve exact availability and replay semantics:", [
    `expected: ${JSON.stringify(expectedToolMetadata)}`,
    `manifest: ${JSON.stringify(pluginManifest.toolMetadata)}`,
  ]);
}
const expectedSetup = {
  providers: [{ id: "qveris", authMethods: ["api-key"], envVars: ["QVERIS_API_KEY"] }],
  requiresRuntime: false,
};
if (!isDeepStrictEqual(pluginManifest.setup, expectedSetup)) {
  fail("openclaw.plugin.json setup must preserve declarative API-key discovery:", [
    `expected: ${JSON.stringify(expectedSetup)}`,
    `manifest: ${JSON.stringify(pluginManifest.setup)}`,
  ]);
}

const toolFactory = registrations[0].factory;
assertConcreteToolNames(toolFactory({}), requiredToolNames, "plugin-config credential");
const originalApiKey = process.env.QVERIS_API_KEY;
try {
  runtimeApi.pluginConfig = {};
  delete process.env.QVERIS_API_KEY;
  if (toolFactory({}) !== null) {
    fail("Compiled tool factory must return null when neither config nor environment credentials are present");
  }
  process.env.QVERIS_API_KEY = "synthetic-compiled-environment-key";
  assertConcreteToolNames(toolFactory({}), requiredToolNames, "environment credential");
} finally {
  if (originalApiKey === undefined) {
    delete process.env.QVERIS_API_KEY;
  } else {
    process.env.QVERIS_API_KEY = originalApiKey;
  }
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

function assertConcreteToolNames(tools, expectedNames, credentialPath) {
  if (!Array.isArray(tools)) {
    fail(`Compiled tool factory did not return tools for the ${credentialPath}`);
  }
  const concreteNames = tools.map((tool) => tool?.name);
  if (JSON.stringify(concreteNames) !== JSON.stringify(expectedNames)) {
    fail(`Compiled tool factory names drifted for the ${credentialPath}:`, [
      `expected: ${JSON.stringify(expectedNames)}`,
      `received: ${JSON.stringify(concreteNames)}`,
    ]);
  }
}
