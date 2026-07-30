import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Keep these Node fault-injection tests outside Vitest's *.test.* discovery.
import {
  ReleaseInvariantError,
  ReleaseTransientError,
  validateRegistryMetadata,
  validateRuntimeResult,
  verifyRegistryRelease,
} from "./check-openclaw-registry-release.mjs";

const expected = {
  packageName: "@qverisai/qveris",
  version: "2026.7.30",
  gitHead: "a".repeat(40),
  pluginId: "qveris",
  toolNames: ["qveris_discover", "qveris_call", "qveris_inspect"],
};
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function metadata(overrides = {}) {
  return {
    version: expected.version,
    gitHead: expected.gitHead,
    "dist.integrity": "sha512-dGVzdA==",
    ...overrides,
  };
}

function runtimeFixture(root, overrides = {}) {
  const pluginRoot = path.join(root, "npm", "node_modules", "@qverisai", "qveris");
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(
    path.join(pluginRoot, "package.json"),
    `${JSON.stringify({ name: expected.packageName, version: expected.version })}\n`,
  );
  const base = {
    inspection: {
      plugin: {
        id: expected.pluginId,
        status: "loaded",
        version: expected.version,
        rootDir: pluginRoot,
        toolNames: [...expected.toolNames],
        contracts: { tools: [...expected.toolNames] },
      },
      tools: [{ names: [...expected.toolNames] }],
      diagnostics: [],
    },
    installedPackage: {
      name: expected.packageName,
      version: expected.version,
    },
    installedIntegrity: metadata()["dist.integrity"],
    compiledRuntime: {
      pluginId: expected.pluginId,
      exportedToolNames: [...expected.toolNames],
      registrationNames: [...expected.toolNames],
      concreteToolNames: [...expected.toolNames],
    },
  };
  return {
    ...base,
    ...overrides,
    inspection: {
      ...base.inspection,
      ...(overrides.inspection ?? {}),
      plugin: {
        ...base.inspection.plugin,
        ...(overrides.inspection?.plugin ?? {}),
      },
    },
  };
}

function fixtureOperations({ metadataSequence = [metadata()], installSequence = [] } = {}) {
  const roots = [];
  const cleaned = [];
  const sleeps = [];
  let metadataIndex = 0;
  let installIndex = 0;
  return {
    roots,
    cleaned,
    sleeps,
    operations: {
      async fetchRegistryMetadata() {
        const value = metadataSequence[Math.min(metadataIndex, metadataSequence.length - 1)];
        metadataIndex += 1;
        if (value instanceof Error) throw value;
        return value;
      },
      createStateDir() {
        const root = mkdtempSync(path.join(os.tmpdir(), "qveris-registry-release-test-"));
        roots.push(root);
        return root;
      },
      async installAndInspect({ stateDir }) {
        const value = installSequence[installIndex];
        installIndex += 1;
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value(stateDir) : runtimeFixture(stateDir);
      },
      cleanupStateDir(stateDir) {
        cleaned.push(stateDir);
        rmSync(stateDir, { recursive: true, force: true });
      },
      async sleep(delayMs) {
        sleeps.push(delayMs);
      },
    },
  };
}

test("accepts exact Registry metadata", () => {
  assert.doesNotThrow(() => validateRegistryMetadata(metadata(), expected));
});

for (const [label, value, pattern] of [
  ["version", metadata({ version: "2026.7.29" }), /version mismatch/],
  ["gitHead", metadata({ gitHead: "b".repeat(40) }), /gitHead mismatch/],
  ["integrity", metadata({ "dist.integrity": "not-an-integrity" }), /invalid dist\.integrity/],
]) {
  test(`rejects Registry ${label} drift`, () => {
    assert.throws(() => validateRegistryMetadata(value, expected), ReleaseInvariantError);
    assert.throws(() => validateRegistryMetadata(value, expected), pattern);
  });
}

test("retries delayed Registry visibility before installing", async () => {
  const fixture = fixtureOperations({
    metadataSequence: [new ReleaseTransientError("not visible"), [], metadata()],
  });
  const result = await verifyRegistryRelease({
    expected,
    operations: fixture.operations,
    metadataAttempts: 3,
    retryDelayMs: 7,
  });
  assert.equal(result.attempts, 1);
  assert.deepEqual(fixture.sleeps, [7, 7]);
  assert.deepEqual(fixture.cleaned, fixture.roots);
});

test("retries a transient install from a fresh isolated state", async () => {
  const fixture = fixtureOperations({
    installSequence: [new ReleaseTransientError("tarball unavailable"), (root) => runtimeFixture(root)],
  });
  const result = await verifyRegistryRelease({
    expected,
    operations: fixture.operations,
    installAttempts: 2,
    retryDelayMs: 11,
  });
  assert.equal(result.attempts, 2);
  assert.equal(new Set(fixture.roots).size, 2);
  assert.deepEqual(fixture.cleaned, fixture.roots);
  assert.deepEqual(fixture.sleeps, [11]);
});

test("fails closed on Registry metadata mismatch without installing", async () => {
  const fixture = fixtureOperations({ metadataSequence: [metadata({ gitHead: "b".repeat(40) })] });
  await assert.rejects(
    verifyRegistryRelease({ expected, operations: fixture.operations }),
    /npm Registry gitHead mismatch/,
  );
  assert.equal(fixture.roots.length, 0);
});

test("fails closed on runtime invariant drift without retrying", async () => {
  const fixture = fixtureOperations({
    installSequence: [
      (root) =>
        runtimeFixture(root, {
          inspection: { plugin: { version: "2026.7.29" } },
        }),
    ],
  });
  await assert.rejects(
    verifyRegistryRelease({ expected, operations: fixture.operations, installAttempts: 3 }),
    /runtime plugin version mismatch/,
  );
  assert.equal(fixture.roots.length, 1);
  assert.deepEqual(fixture.cleaned, fixture.roots);
});

test("fails closed when isolated-state cleanup fails", async () => {
  const fixture = fixtureOperations();
  fixture.operations.cleanupStateDir = () => {
    throw new Error("injected cleanup failure");
  };
  try {
    await assert.rejects(
      verifyRegistryRelease({ expected, operations: fixture.operations, installAttempts: 3 }),
      /failed to clean isolated OpenClaw state.*injected cleanup failure/,
    );
    assert.equal(fixture.roots.length, 1);
  } finally {
    for (const root of fixture.roots) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects an out-of-state source fallback", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "qveris-registry-release-state-"));
  const sourceDir = mkdtempSync(path.join(os.tmpdir(), "qveris-registry-release-source-"));
  try {
    const result = runtimeFixture(sourceDir);
    assert.throws(() => validateRuntimeResult(result, expected, metadata(), stateDir), /must be inside/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

for (const [label, mutate, pattern] of [
  [
    "status",
    (value) => {
      value.inspection.plugin.status = "disabled";
    },
    /runtime plugin status mismatch/,
  ],
  [
    "tool names",
    (value) => {
      value.inspection.plugin.toolNames = ["qveris_discover", "qveris_inspect"];
    },
    /runtime tool names mismatch/,
  ],
  [
    "manifest contract",
    (value) => {
      value.inspection.plugin.contracts.tools = ["qveris_discover", "qveris_inspect"];
    },
    /runtime manifest tool contract mismatch/,
  ],
  [
    "registration groups",
    (value) => {
      value.inspection.tools = [{ names: ["qveris_discover", "qveris_inspect"] }];
    },
    /runtime registration-group names mismatch/,
  ],
  [
    "diagnostics",
    (value) => {
      value.inspection.diagnostics = [{ level: "error", message: "broken" }];
    },
    /runtime error diagnostics/,
  ],
  [
    "registration group shape",
    (value) => {
      value.inspection.tools = {};
    },
    /runtime registration groups must be an array/,
  ],
  [
    "diagnostics shape",
    (value) => {
      value.inspection.diagnostics = {};
    },
    /runtime diagnostics must be an array/,
  ],
  [
    "tool-name shape",
    (value) => {
      value.inspection.plugin.toolNames = {};
    },
    /runtime tool names must be an array/,
  ],
  [
    "manifest-contract shape",
    (value) => {
      value.inspection.plugin.contracts.tools = {};
    },
    /runtime manifest tool contract must be an array/,
  ],
  [
    "installed package name",
    (value) => {
      value.installedPackage.name = "@qverisai/not-qveris";
    },
    /installed package name mismatch/,
  ],
  [
    "installed package version",
    (value) => {
      value.installedPackage.version = "2026.7.29";
    },
    /installed package version mismatch/,
  ],
  [
    "installed package integrity",
    (value) => {
      value.installedIntegrity = "sha512-b3RoZXI=";
    },
    /installed package integrity mismatch/,
  ],
  [
    "compiled runtime plugin id",
    (value) => {
      value.compiledRuntime.pluginId = "not-qveris";
    },
    /compiled runtime plugin id mismatch/,
  ],
  [
    "compiled exported tool names",
    (value) => {
      value.compiledRuntime.exportedToolNames = ["qveris_discover", "qveris_inspect"];
    },
    /compiled runtime exported tool names mismatch/,
  ],
  [
    "compiled registration names",
    (value) => {
      value.compiledRuntime.registrationNames = ["qveris_discover", "qveris_inspect"];
    },
    /compiled runtime registration names mismatch/,
  ],
  [
    "compiled concrete tool names",
    (value) => {
      value.compiledRuntime.concreteToolNames = ["qveris_discover", "qveris_inspect"];
    },
    /compiled runtime concrete tool names mismatch/,
  ],
]) {
  test(`rejects runtime ${label} drift`, () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "qveris-registry-release-drift-"));
    try {
      const value = runtimeFixture(stateDir);
      mutate(value);
      assert.throws(() => validateRuntimeResult(value, expected, metadata(), stateDir), pattern);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

test("reports Registry visibility exhaustion and redacts sensitive values", async () => {
  const secret = "registry-secret-that-must-not-escape";
  const fixture = fixtureOperations({
    metadataSequence: [new ReleaseTransientError(`first ${secret}`), new ReleaseTransientError(`second ${secret}`)],
  });
  await assert.rejects(
    verifyRegistryRelease({
      expected,
      operations: fixture.operations,
      metadataAttempts: 2,
      retryDelayMs: 0,
      sensitiveValues: [secret],
    }),
    (error) => {
      assert.ok(error instanceof ReleaseTransientError);
      assert.match(error.message, /npm Registry metadata failed after 2 attempts/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.equal(fixture.roots.length, 0);
});

test("reports retry exhaustion and redacts sensitive values", async () => {
  const secret = "synthetic-secret-that-must-not-escape";
  const fixture = fixtureOperations({
    installSequence: [new ReleaseTransientError(`first ${secret}`), new ReleaseTransientError(`second ${secret}`)],
  });
  await assert.rejects(
    verifyRegistryRelease({
      expected,
      operations: fixture.operations,
      installAttempts: 2,
      retryDelayMs: 0,
      sensitiveValues: [secret],
    }),
    (error) => {
      assert.ok(error instanceof ReleaseTransientError);
      assert.match(error.message, /attempt 1: first \*\*\*/);
      assert.match(error.message, /attempt 2: second \*\*\*/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.deepEqual(fixture.cleaned, fixture.roots);
});

test("keeps Registry verification between npm publish and GitHub Release creation", () => {
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/qveris-plugin-publish.yml"), "utf8");
  const publishIndex = workflow.indexOf("- name: Publish to npm");
  const verificationJobIndex = workflow.indexOf("verify_release:");
  const registryIndex = workflow.indexOf("- name: Verify published npm artifact with OpenClaw");
  const releaseIndex = workflow.indexOf("- name: Create GitHub Release");

  assert.ok(publishIndex >= 0);
  assert.ok(verificationJobIndex > publishIndex);
  assert.ok(registryIndex > verificationJobIndex);
  assert.ok(releaseIndex > registryIndex);
  assert.match(workflow.slice(verificationJobIndex, registryIndex), /needs: publish/);
  assert.match(
    workflow.slice(registryIndex, releaseIndex),
    /check:runtime:registry -- --expected-git-head "\$GITHUB_SHA"/,
  );
});
