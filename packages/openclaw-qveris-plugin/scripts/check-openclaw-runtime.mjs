import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = readJson(path.join(packageRoot, "package.json"));
const manifest = readJson(path.join(packageRoot, "openclaw.plugin.json"));
const expectedToolNames = [...(manifest.contracts?.tools ?? [])];
const args = process.argv.slice(2);
const pack = takeFlag(args, "--pack");
const installSpec = takeOption(args, "--install-spec");

if (args.length > 0) {
  fail(`Unknown arguments: ${args.join(" ")}`);
}
if (pack && installSpec) {
  fail("--pack and --install-spec are mutually exclusive");
}
if (expectedToolNames.length === 0) {
  fail("openclaw.plugin.json must declare contracts.tools before runtime validation");
}

const openclawPackagePath = path.join(packageRoot, "node_modules", "openclaw", "package.json");
const openclawPackage = readJson(openclawPackagePath);
const openclawBin = resolveOpenClawBin(openclawPackagePath, openclawPackage.bin);
const stateDir = mkdtempSync(path.join(os.tmpdir(), "qveris-openclaw-runtime-"));
const homeDir = path.join(stateDir, "home");
const configPath = path.join(stateDir, "openclaw.json");
const env = {
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  OPENCLAW_HOME: homeDir,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath,
  QVERIS_API_KEY: "synthetic-openclaw-runtime-contract-key",
};
delete env.QVERIS_BASE_URL;

try {
  let spec = installSpec;
  if (pack) {
    spec = createPackageTarball(stateDir);
  }

  if (spec) {
    runOpenClaw(["plugins", "install", spec, "--pin"]);
  } else {
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          plugins: {
            allow: [manifest.id],
            load: { paths: [packageRoot] },
            entries: { [manifest.id]: { enabled: true } },
          },
          tools: { alsoAllow: [manifest.id] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const inspection = JSON.parse(runOpenClaw(["plugins", "inspect", manifest.id, "--runtime", "--json"]));
  const registeredToolNames = [...(inspection.plugin?.toolNames ?? [])].sort();
  const instantiatedToolNames = [...(inspection.tools ?? [])]
    .flatMap((tool) => (Array.isArray(tool.names) ? tool.names : [tool.name]))
    .filter((name) => typeof name === "string")
    .sort();
  const expected = [...expectedToolNames].sort();
  const errorDiagnostics = [...(inspection.diagnostics ?? [])].filter((diagnostic) => diagnostic.level === "error");

  assertEqual(inspection.plugin?.id, manifest.id, "runtime plugin id");
  assertEqual(inspection.plugin?.status, "loaded", "runtime plugin status");
  assertArrayEqual(registeredToolNames, expected, "registered tool names");
  assertArrayEqual(instantiatedToolNames, expected, "instantiated tool names");
  if (errorDiagnostics.length > 0) {
    fail(`OpenClaw reported runtime diagnostics:\n${JSON.stringify(errorDiagnostics, null, 2)}`);
  }

  console.log(
    `OpenClaw runtime contract OK: host ${openclawPackage.version}, plugin ${packageJson.version}, tools ${expected.join(", ")}`,
  );
} finally {
  if (process.env.QVERIS_KEEP_OPENCLAW_RUNTIME_STATE !== "1") {
    rmSync(stateDir, { recursive: true, force: true });
  } else {
    console.log(`Preserved OpenClaw runtime state: ${stateDir}`);
  }
}

function createPackageTarball(destination) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["pack", "--json", "--pack-destination", destination], {
    cwd: packageRoot,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    fail(`npm pack failed (${result.status ?? "signal"}):\n${formatProcessOutput(result)}`);
  }
  const [packed] = JSON.parse(result.stdout);
  if (!packed?.filename) {
    fail(`npm pack did not report a filename:\n${result.stdout}`);
  }
  return path.join(destination, packed.filename);
}

function runOpenClaw(openclawArgs) {
  const result = spawnSync(process.execPath, [openclawBin, ...openclawArgs], {
    cwd: packageRoot,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    fail(`openclaw ${openclawArgs.join(" ")} failed (${result.status ?? "signal"}):\n${formatProcessOutput(result)}`);
  }
  return result.stdout.trim();
}

function formatProcessOutput(result) {
  return [result.stdout, result.stderr]
    .map((output) => output?.trim())
    .filter(Boolean)
    .join("\n");
}

function resolveOpenClawBin(packagePath, bin) {
  const relativeBin = typeof bin === "string" ? bin : bin?.openclaw;
  if (typeof relativeBin !== "string" || relativeBin.length === 0) {
    fail("Installed openclaw package does not declare an openclaw executable");
  }
  return path.resolve(path.dirname(packagePath), relativeBin);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function takeFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return false;
  argv.splice(index, 1);
  return true;
}

function takeOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} requires a value`);
  }
  argv.splice(index, 2);
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function fail(message) {
  throw new Error(message);
}
