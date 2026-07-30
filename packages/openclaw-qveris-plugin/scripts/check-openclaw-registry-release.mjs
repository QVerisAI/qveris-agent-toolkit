import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), "..");
const requiredToolNames = ["qveris_discover", "qveris_call", "qveris_inspect"];
const syntheticApiKey = "synthetic-openclaw-registry-release-key";
const publicRegistryUrl = "https://registry.npmjs.org";

export class ReleaseInvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseInvariantError";
  }
}

export class ReleaseTransientError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseTransientError";
  }
}

export function validateRegistryMetadata(metadata, expected) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ReleaseTransientError("npm Registry metadata must be a JSON object");
  }
  if (metadata.version !== expected.version) {
    throw new ReleaseInvariantError(
      `npm Registry version mismatch: expected ${JSON.stringify(expected.version)}, received ${JSON.stringify(metadata.version)}`,
    );
  }
  if (metadata.gitHead !== expected.gitHead) {
    throw new ReleaseInvariantError(
      `npm Registry gitHead mismatch: expected ${JSON.stringify(expected.gitHead)}, received ${JSON.stringify(metadata.gitHead)}`,
    );
  }
  if (
    typeof metadata["dist.integrity"] !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata["dist.integrity"])
  ) {
    throw new ReleaseInvariantError("npm Registry metadata has an invalid dist.integrity");
  }
}

export function validateRuntimeResult(result, expected, metadata, stateDir) {
  const inspection = result?.inspection;
  const installedPackage = result?.installedPackage;
  const plugin = inspection?.plugin;
  const expectedSortedNames = [...expected.toolNames].sort();
  const runtimeTools = assertArray(inspection?.tools, "runtime registration groups");
  const diagnostics = assertArray(inspection?.diagnostics, "runtime diagnostics");
  const runtimeToolNames = assertArray(plugin?.toolNames, "runtime tool names");
  const manifestToolNames = assertArray(plugin?.contracts?.tools, "runtime manifest tool contract");
  const registrationGroupNames = runtimeTools
    .flatMap((tool) => (Array.isArray(tool?.names) ? tool.names : [tool?.name]))
    .filter((name) => typeof name === "string")
    .sort();
  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic?.level === "error");

  assertEqual(plugin?.id, expected.pluginId, "runtime plugin id");
  assertEqual(plugin?.status, "loaded", "runtime plugin status");
  assertEqual(plugin?.version, expected.version, "runtime plugin version");
  assertArrayEqual([...runtimeToolNames].sort(), expectedSortedNames, "runtime tool names");
  assertArrayEqual([...manifestToolNames], expected.toolNames, "runtime manifest tool contract");
  assertArrayEqual(registrationGroupNames, expectedSortedNames, "runtime registration-group names");
  assertPathWithin(plugin?.rootDir, stateDir, "registry-installed plugin root");
  assertEqual(installedPackage?.name, expected.packageName, "installed package name");
  assertEqual(installedPackage?.version, expected.version, "installed package version");
  assertEqual(result?.installedIntegrity, metadata["dist.integrity"], "installed package integrity");
  assertEqual(result?.compiledRuntime?.pluginId, expected.pluginId, "compiled runtime plugin id");
  assertArrayEqual(
    result?.compiledRuntime?.exportedToolNames,
    expected.toolNames,
    "compiled runtime exported tool names",
  );
  assertArrayEqual(
    result?.compiledRuntime?.registrationNames,
    expected.toolNames,
    "compiled runtime registration names",
  );
  assertArrayEqual(
    result?.compiledRuntime?.concreteToolNames,
    expected.toolNames,
    "compiled runtime concrete tool names",
  );
  if (errorDiagnostics.length > 0) {
    throw new ReleaseInvariantError(`OpenClaw reported runtime error diagnostics: ${JSON.stringify(errorDiagnostics)}`);
  }
}

export async function verifyRegistryRelease(options) {
  const {
    expected,
    operations,
    metadataAttempts = 12,
    installAttempts = 3,
    retryDelayMs = 5_000,
    sensitiveValues = [],
  } = options;
  assertPositiveInteger(metadataAttempts, "metadataAttempts");
  assertPositiveInteger(installAttempts, "installAttempts");
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new ReleaseInvariantError("retryDelayMs must be a non-negative integer");
  }

  const spec = `${expected.packageName}@${expected.version}`;
  const secrets = [syntheticApiKey, ...sensitiveValues].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  const metadata = await retryTransientPhase({
    label: "npm Registry metadata",
    attempts: metadataAttempts,
    delayMs: retryDelayMs,
    sleep: operations.sleep,
    secrets,
    operation: async () => {
      const candidate = await operations.fetchRegistryMetadata(spec);
      validateRegistryMetadata(candidate, expected);
      return candidate;
    },
  });

  const failures = [];
  for (let attempt = 1; attempt <= installAttempts; attempt += 1) {
    const stateDir = operations.createStateDir();
    let result;
    let attemptError;
    try {
      result = await operations.installAndInspect({ spec, stateDir });
      validateRuntimeResult(result, expected, metadata, stateDir);
    } catch (error) {
      attemptError = error;
    }

    try {
      await operations.cleanupStateDir(stateDir);
    } catch (cleanupError) {
      const detail = sanitizeError(cleanupError, secrets);
      throw new ReleaseInvariantError(`failed to clean isolated OpenClaw state ${JSON.stringify(stateDir)}: ${detail}`);
    }

    if (!attemptError) {
      return { metadata, attempts: attempt };
    }
    if (attemptError instanceof ReleaseInvariantError) {
      throw new ReleaseInvariantError(sanitizeError(attemptError, secrets));
    }
    failures.push(`attempt ${attempt}: ${sanitizeError(attemptError, secrets)}`);
    if (attempt < installAttempts) {
      await operations.sleep(retryDelayMs);
    }
  }

  throw new ReleaseTransientError(
    `registry-installed OpenClaw verification failed after ${installAttempts} attempts:\n- ${failures.join("\n- ")}`,
  );
}

export function createDefaultOperations({ packageJson, manifest }) {
  const openclawPackagePath = path.join(packageRoot, "node_modules", "openclaw", "package.json");
  const openclawPackage = readJson(openclawPackagePath);
  const openclawBin = resolveOpenClawBin(openclawPackagePath, openclawPackage.bin);

  return {
    fetchRegistryMetadata(spec) {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const result = spawnSync(
        npm,
        [
          "view",
          spec,
          "version",
          "dist.integrity",
          "gitHead",
          "--json",
          "--prefer-online",
          "--registry",
          publicRegistryUrl,
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60_000,
          shell: process.platform === "win32",
        },
      );
      if (result.status !== 0) {
        throw new ReleaseTransientError(
          `npm view failed (${result.status ?? "signal"}): ${formatProcessOutput(result)}`,
        );
      }
      try {
        return JSON.parse(result.stdout);
      } catch (error) {
        throw new ReleaseTransientError(
          `npm view returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    createStateDir() {
      return mkdtempSync(path.join(os.tmpdir(), "qveris-openclaw-registry-release-"));
    },
    async installAndInspect({ spec, stateDir }) {
      const homeDir = path.join(stateDir, "home");
      const configPath = path.join(stateDir, "openclaw.json");
      const env = {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        OPENCLAW_HOME: homeDir,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: configPath,
        QVERIS_API_KEY: syntheticApiKey,
        NPM_CONFIG_REGISTRY: publicRegistryUrl,
        npm_config_registry: publicRegistryUrl,
      };
      delete env.QVERIS_BASE_URL;

      runOpenClaw(openclawBin, ["plugins", "install", spec, "--pin"], {
        cwd: stateDir,
        env,
        timeoutMs: 300_000,
      });
      const rawInspection = runOpenClaw(openclawBin, ["plugins", "inspect", manifest.id, "--runtime", "--json"], {
        cwd: stateDir,
        env,
        timeoutMs: 120_000,
      });
      let inspection;
      try {
        inspection = JSON.parse(rawInspection);
      } catch (error) {
        throw new ReleaseInvariantError(
          `OpenClaw runtime inspection returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const installedRoot = inspection?.plugin?.rootDir;
      assertPathWithin(installedRoot, stateDir, "registry-installed plugin root");
      const installedPackage = readJson(path.join(installedRoot, "package.json"));
      const managedProjectRoot = path.resolve(installedRoot, "../../..");
      assertPathWithin(managedProjectRoot, stateDir, "OpenClaw managed npm project root");
      const packageLock = readJson(path.join(managedProjectRoot, "package-lock.json"));
      const installedIntegrity = packageLock?.packages?.[`node_modules/${packageJson.name}`]?.integrity;
      const compiledRuntime = await inspectCompiledRuntime(installedRoot);
      return { inspection, installedPackage, installedIntegrity, compiledRuntime };
    },
    cleanupStateDir(stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
    },
    sleep(delayMs) {
      return new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    openclawVersion: openclawPackage.version,
    packageVersion: packageJson.version,
  };
}

async function retryTransientPhase({ label, attempts, delayMs, sleep, secrets, operation }) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ReleaseInvariantError) {
        throw new ReleaseInvariantError(sanitizeError(error, secrets));
      }
      failures.push(`attempt ${attempt}: ${sanitizeError(error, secrets)}`);
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw new ReleaseTransientError(`${label} failed after ${attempts} attempts:\n- ${failures.join("\n- ")}`);
}

function runOpenClaw(openclawBin, args, { cwd, env, timeoutMs }) {
  const result = spawnSync(process.execPath, [openclawBin, ...args], {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.status !== 0) {
    throw new ReleaseTransientError(
      `openclaw ${args.join(" ")} failed (${result.status ?? "signal"}): ${formatProcessOutput(result)}`,
    );
  }
  return result.stdout.trim();
}

async function inspectCompiledRuntime(installedRoot) {
  try {
    const entryUrl = pathToFileURL(path.join(installedRoot, "dist", "index.js"));
    entryUrl.searchParams.set("registry-release-root", installedRoot);
    const runtimeModule = await import(entryUrl.href);
    const runtimePlugin = runtimeModule.default;
    if (!runtimePlugin || typeof runtimePlugin.register !== "function") {
      throw new ReleaseInvariantError("compiled runtime must export a plugin with register()");
    }

    const registrations = [];
    const runtimeApi = {
      pluginConfig: { apiKey: syntheticApiKey },
      registerTool(factory, options) {
        registrations.push({ factory, options });
      },
    };
    runtimePlugin.register(runtimeApi);
    if (
      registrations.length !== 1 ||
      typeof registrations[0]?.factory !== "function" ||
      !Array.isArray(registrations[0]?.options?.names)
    ) {
      throw new ReleaseInvariantError("compiled runtime must make exactly one named tool-factory registration");
    }
    const concreteTools = registrations[0].factory({});
    if (!Array.isArray(concreteTools)) {
      throw new ReleaseInvariantError("compiled runtime tool factory must instantiate concrete tools with credentials");
    }

    return {
      pluginId: runtimePlugin.id,
      exportedToolNames: assertArray(runtimeModule.QVERIS_TOOL_NAMES, "compiled runtime exported tool names"),
      registrationNames: registrations[0].options.names,
      concreteToolNames: concreteTools.map((tool) => tool?.name),
    };
  } catch (error) {
    if (error instanceof ReleaseInvariantError) {
      throw error;
    }
    throw new ReleaseInvariantError(
      `failed to inspect compiled Registry runtime: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function formatProcessOutput(result) {
  return [result.stdout, result.stderr, result.error?.stack ?? result.error?.message]
    .map((output) => output?.trim())
    .filter(Boolean)
    .join("\n");
}

function parseExpectedGitHead(argv) {
  const args = [...argv];
  const index = args.indexOf("--expected-git-head");
  if (index === -1 || index === args.length - 1) {
    throw new ReleaseInvariantError("--expected-git-head <40-character commit SHA> is required");
  }
  const [gitHead] = args.splice(index + 1, 1);
  args.splice(index, 1);
  if (args.length > 0) {
    throw new ReleaseInvariantError(`unknown arguments: ${args.join(" ")}`);
  }
  if (!/^[0-9a-f]{40}$/.test(gitHead)) {
    throw new ReleaseInvariantError("--expected-git-head must be a lowercase 40-character commit SHA");
  }
  return gitHead;
}

function resolveOpenClawBin(packagePath, bin) {
  const relativeBin = typeof bin === "string" ? bin : bin?.openclaw;
  if (typeof relativeBin !== "string" || relativeBin.length === 0) {
    throw new ReleaseInvariantError("installed openclaw package does not declare an openclaw executable");
  }
  return path.resolve(path.dirname(packagePath), relativeBin);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ReleaseInvariantError(`${label} must be a positive integer`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new ReleaseInvariantError(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertArrayEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ReleaseInvariantError(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new ReleaseInvariantError(`${label} must be an array`);
  }
  return value;
}

function assertPathWithin(actual, expectedParent, label) {
  const actualPath = resolveRealPath(actual, label);
  const parentPath = resolveRealPath(expectedParent, `${label} parent`);
  const relative = path.relative(parentPath, actualPath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new ReleaseInvariantError(
      `${label} must be inside ${JSON.stringify(parentPath)}, received ${JSON.stringify(actualPath)}`,
    );
  }
}

function resolveRealPath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReleaseInvariantError(`${label} must be a non-empty path`);
  }
  try {
    return realpathSync(value);
  } catch (error) {
    throw new ReleaseInvariantError(
      `${label} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sanitizeError(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    message = message.split(secret).join("***");
  }
  return message;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function main() {
  const packageJson = readJson(path.join(packageRoot, "package.json"));
  const manifest = readJson(path.join(packageRoot, "openclaw.plugin.json"));
  const expected = {
    packageName: packageJson.name,
    version: packageJson.version,
    gitHead: parseExpectedGitHead(process.argv.slice(2)),
    pluginId: manifest.id,
    toolNames: requiredToolNames,
  };
  const sensitiveValues = [process.env.NODE_AUTH_TOKEN, process.env.NPM_TOKEN, process.env.QVERIS_API_KEY];
  const operations = createDefaultOperations({ packageJson, manifest });
  const result = await verifyRegistryRelease({ expected, operations, sensitiveValues });
  console.log(
    `npm Registry release OK: host ${operations.openclawVersion}, plugin ${expected.version}, ` +
      `tools ${expected.toolNames.join(", ")}, install attempts ${result.attempts}`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const secrets = [
      syntheticApiKey,
      process.env.NODE_AUTH_TOKEN,
      process.env.NPM_TOKEN,
      process.env.QVERIS_API_KEY,
    ].filter(Boolean);
    console.error(sanitizeError(error, secrets));
    process.exitCode = 1;
  });
}
