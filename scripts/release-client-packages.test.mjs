import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BENCHMARK_CADENCE_WORKFLOW,
  CLIENTS,
  PUBLIC_VERSION_REFERENCES,
  benchmarkCadenceDispatchArgs,
  extractChangelogRelease,
  githubRepositoryFromRemoteUrl,
  publishReleasePlan,
  readReleasePlan,
  selectWorkflowRun,
  workflowDispatchInputs,
  workflowTagPatterns,
} from "./release-client-packages.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureRoot(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "qveris-client-release-"));
  const versions = {
    cli: "1.2.3",
    mcp: "2.3.4",
    "js-sdk": "3.4.5",
    "python-sdk": "4.5.6",
    ...overrides,
  };

  for (const client of CLIENTS) {
    const directory = join(root, client.directory);
    mkdirSync(directory, { recursive: true });
    const version = versions[client.key];
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-07-23\n\n### Added\n\n- ${client.label} release\n\n## [0.0.1] - 2026-01-01\n`,
    );

    if (client.manifest === "npm") {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
      writeFileSync(join(directory, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
      if (client.serverManifest) {
        writeFileSync(join(directory, "server.json"), JSON.stringify({ version, packages: [{ version }] }));
      }
    } else {
      writeFileSync(join(directory, "pyproject.toml"), `[project]\nname = "qveris"\nversion = "${version}"\n`);
      writeFileSync(join(directory, "uv.lock"), `version = 1\n\n[[package]]\nname = "qveris"\nversion = "${version}"\n`);
    }

    const workflowDirectory = join(root, ".github/workflows");
    mkdirSync(workflowDirectory, { recursive: true });
    writeFileSync(
      join(workflowDirectory, client.workflow),
      `name: Publish ${client.label}\n\non:\n  workflow_dispatch:\n  push:\n    tags:\n      - "${client.tagPrefix}*"\n\njobs: {}\n`,
    );
  }
  writeFileSync(
    join(root, ".github/workflows", BENCHMARK_CADENCE_WORKFLOW),
    "name: Benchmark cadence\n\non:\n  workflow_dispatch:\n    inputs:\n      release_sha:\n        required: true\n\njobs: {}\n",
  );
  const publicReferences = new Map();
  for (const reference of PUBLIC_VERSION_REFERENCES) {
    const lines = publicReferences.get(reference.path) || [];
    lines.push(`${reference.marker} v${versions[reference.key]}`);
    publicReferences.set(reference.path, lines);
  }
  for (const [path, lines] of publicReferences) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${lines.join("\n")}\n`);
  }
  return root;
}

test("extractChangelogRelease returns only the requested release notes", () => {
  const notes = extractChangelogRelease(
    "# Changelog\n\n## [1.2.0] - 2026-07-23\n\n### Added\n\n- new\n\n## [1.1.0] - 2026-07-01\n\n- old\n",
    "1.2.0",
  );
  assert.equal(notes, "### Added\n\n- new");
});

test("workflowTagPatterns reads only push tag triggers", () => {
  assert.deepEqual(
    workflowTagPatterns(
      'name: Test\n\non:\n  pull_request:\n    paths:\n      - "js-sdk-v*"\n  push:\n    branches: [main]\n    tags:\n      - "js-sdk-v*"\n',
    ),
    ["js-sdk-v*"],
  );
});

test("workflowDispatchInputs reads only direct workflow_dispatch inputs", () => {
  assert.deepEqual(
    workflowDispatchInputs(
      "name: Test\n\non:\n  workflow_dispatch:\n    inputs:\n      release_sha:\n        required: true\n      dry_run:\n        type: boolean\n\njobs:\n  test:\n    release_sha: not-an-input\n",
    ),
    ["release_sha", "dry_run"],
  );
  assert.deepEqual(
    workflowDispatchInputs(
      "name: Test\n\non:\n  workflow_dispatch:\n    # release_sha:\n    inputs:\n      other:\n        description: release_sha\n\njobs:\n  release_sha:\n    runs-on: ubuntu-latest\n",
    ),
    ["other"],
  );
});

test("Git remote URLs resolve to the explicit repository used by gh operations", () => {
  assert.equal(
    githubRepositoryFromRemoteUrl("git@github.com:QVerisAI/qveris-agent-toolkit.git"),
    "QVerisAI/qveris-agent-toolkit",
  );
  assert.equal(
    githubRepositoryFromRemoteUrl("https://github.com/QVerisAI/qveris-agent-toolkit.git"),
    "QVerisAI/qveris-agent-toolkit",
  );
  assert.equal(
    githubRepositoryFromRemoteUrl("ssh://git@example.test/QVerisAI/qveris-agent-toolkit.git"),
    "example.test/QVerisAI/qveris-agent-toolkit",
  );
  assert.throws(() => githubRepositoryFromRemoteUrl("../local-repository"), /Unsupported Git remote URL/);
});

test("readReleasePlan validates and coordinates all four package tags", () => {
  const releases = readReleasePlan(fixtureRoot());
  assert.deepEqual(
    releases.map(({ key, tag }) => [key, tag]),
    [
      ["cli", "cli-v1.2.3"],
      ["mcp", "mcp-v2.3.4"],
      ["js-sdk", "js-sdk-v3.4.5"],
      ["python-sdk", "python-sdk-v4.5.6"],
    ],
  );
  assert.ok(releases.every((release) => release.notes.includes(`${release.label} release`)));
});

test("repository publish workflows exist and listen for every coordinated tag", () => {
  const releases = readReleasePlan(REPOSITORY_ROOT);
  assert.deepEqual(
    releases.map(({ workflow, tagPrefix }) => [workflow, `${tagPrefix}*`]),
    [
      ["cli-publish.yml", "cli-v*"],
      ["mcp-publish.yml", "mcp-v*"],
      ["js-sdk-publish.yml", "js-sdk-v*"],
      ["python-sdk-publish.yml", "python-sdk-v*"],
    ],
  );
});

test("MCP publishing validates and passes through its package-configured npm dist-tag", () => {
  const workflow = readFileSync(join(REPOSITORY_ROOT, ".github/workflows", "mcp-publish.yml"), "utf8");

  assert.match(workflow, /NPM_DIST_TAG=\$\(node -p "require\('\.\/package\.json'\)\.publishConfig\?\.tag \|\| 'latest'"\)/);
  assert.match(workflow, /Invalid npm dist-tag: \$NPM_DIST_TAG/);
  assert.match(workflow, /npm publish --provenance --access public --tag "\$NPM_DIST_TAG"/);
});

test("repository cadence workflow passes the task set to the reference adapter, verifies the exact CLI version, and uploads sanitized artifacts", () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, ".github/workflows", BENCHMARK_CADENCE_WORKFLOW),
    "utf8",
  );
  assert.match(
    workflow,
    /--adapter-arg "\$\{REFERENCE_ADAPTER\}"\s+--adapter-arg "\$\{TASK_SET\}"/,
  );
  assert.match(workflow, /\[\[ "\$\{ACTUAL_VERSION\}" != "codex-cli \$\{CLI_VERSION\}" \]\]/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /--pr-body "\$\{RUNNER_TEMP\}\/pr-body\.md"/);
  assert.match(workflow, /results\/\$\{\{ env\.REFERENCE_STEM \}\}\.runs\.jsonl/);
  assert.match(workflow, /results\/\$\{\{ env\.REFERENCE_STEM \}\}\.summary\.json/);
  assert.match(workflow, /results\/\$\{\{ env\.CONFIGURED_STEM \}\}\.runs\.jsonl/);
  assert.match(workflow, /results\/\$\{\{ env\.CONFIGURED_STEM \}\}\.summary\.json/);
  assert.match(workflow, /benchmarks\/discover-call\/results\/README\.md/);
  assert.doesNotMatch(workflow, /BENCHMARK_PR_TOKEN/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|git push|gh pr create/);
});

test("release preflight requires the protected benchmark cadence dispatch input", () => {
  const missingRoot = fixtureRoot();
  rmSync(join(missingRoot, ".github/workflows", BENCHMARK_CADENCE_WORKFLOW));
  assert.throws(() => readReleasePlan(missingRoot), /Benchmark cadence workflow is missing/);

  const mismatchedRoot = fixtureRoot();
  writeFileSync(
    join(mismatchedRoot, ".github/workflows", BENCHMARK_CADENCE_WORKFLOW),
    "name: Benchmark cadence\n\non:\n  workflow_dispatch:\n\njobs: {}\n",
  );
  assert.throws(() => readReleasePlan(mismatchedRoot), /must expose a workflow_dispatch release_sha input/);

  const deceptiveRoot = fixtureRoot();
  writeFileSync(
    join(deceptiveRoot, ".github/workflows", BENCHMARK_CADENCE_WORKFLOW),
    "name: Benchmark cadence\n\non:\n  workflow_dispatch:\n    inputs:\n      other:\n        description: release_sha\n\njobs:\n  release_sha:\n    runs-on: ubuntu-latest\n",
  );
  assert.throws(() => readReleasePlan(deceptiveRoot), /must expose a workflow_dispatch release_sha input/);
});

test("readReleasePlan rejects drift between package and release metadata", () => {
  const root = fixtureRoot();
  writeFileSync(
    join(root, "packages/mcp/server.json"),
    JSON.stringify({ version: "2.3.3", packages: [{ version: "2.3.3" }] }),
  );
  writeFileSync(join(root, "packages/python-sdk/uv.lock"), 'version = 1\n\n[[package]]\nname = "qveris"\nversion = "4.5.5"\n');

  assert.throws(
    () => readReleasePlan(root),
    (error) =>
      error.message.includes("MCP: server.json version (2.3.3) must equal 2.3.4") &&
      error.message.includes("Python SDK: uv.lock qveris version (4.5.5) must equal 4.5.6"),
  );
});

test("readReleasePlan rejects stale or missing public client version references", () => {
  const staleRoot = fixtureRoot();
  const reference = PUBLIC_VERSION_REFERENCES.find(
    ({ key, path }) => key === "cli" && path === "docs/en-US/cli.md",
  );
  writeFileSync(join(staleRoot, reference.path), `${reference.marker} v1.2.2\n`);
  assert.throws(
    () => readReleasePlan(staleRoot),
    /docs\/en-US\/cli\.md "latest tested release" version \(1\.2\.2\) must equal 1\.2\.3/,
  );

  const missingRoot = fixtureRoot();
  rmSync(join(missingRoot, "agent/llms.txt"));
  assert.throws(() => readReleasePlan(missingRoot), /public version surface is missing: agent\/llms\.txt/);
});

test("readReleasePlan accepts prerelease versions on public version surfaces", () => {
  const root = fixtureRoot({ cli: "1.2.3-rc.1" });
  assert.equal(
    readReleasePlan(root).find(({ key }) => key === "cli").version,
    "1.2.3-rc.1",
  );
});

test("readReleasePlan rejects a missing or mismatched publish workflow before tagging", () => {
  const missingRoot = fixtureRoot();
  rmSync(join(missingRoot, ".github/workflows/js-sdk-publish.yml"));
  assert.throws(
    () => readReleasePlan(missingRoot),
    /JavaScript SDK: publish workflow is missing: \.github\/workflows\/js-sdk-publish\.yml/,
  );

  const mismatchedRoot = fixtureRoot();
  writeFileSync(
    join(mismatchedRoot, ".github/workflows/js-sdk-publish.yml"),
    'name: Publish JavaScript SDK\n\non:\n  push:\n    tags:\n      - "javascript-v*"\n',
  );
  assert.throws(
    () => readReleasePlan(mismatchedRoot),
    /JavaScript SDK: \.github\/workflows\/js-sdk-publish\.yml must listen for push\.tags pattern "js-sdk-v\*"/,
  );
});

test("publishReleasePlan waits for each workflow to succeed before pushing the next tag", async () => {
  const releases = readReleasePlan(fixtureRoot());
  const events = [];

  const runs = await publishReleasePlan(releases, {
    head: "release-head",
    watch: true,
    log: () => {},
    inspectTag: async (release) => {
      events.push(`inspect:${release.tag}`);
      return { local: null, remote: null };
    },
    validateTag: () => {},
    listRuns: async (release) => {
      events.push(`snapshot:${release.tag}`);
      return [];
    },
    createTag: async (release) => events.push(`create:${release.tag}`),
    pushTag: async (release) => events.push(`push:${release.tag}`),
    waitForRun: async (release) => {
      events.push(`registered:${release.tag}`);
      return { databaseId: release.tag };
    },
    watchRun: async (run) => events.push(`watch:${run.databaseId}`),
    dispatchCadence: async (head) => events.push(`cadence:${head}`),
  });

  assert.equal(runs.length, 4);
  for (let index = 0; index < releases.length - 1; index += 1) {
    assert.ok(
      events.indexOf(`registered:${releases[index].tag}`) < events.indexOf(`push:${releases[index + 1].tag}`),
      `${releases[index].tag} must register before the next tag push`,
    );
    assert.ok(
      events.indexOf(`watch:${releases[index].tag}`) < events.indexOf(`push:${releases[index + 1].tag}`),
      `${releases[index].tag} must succeed before the next tag push`,
    );
  }
  for (const release of releases) {
    assert.ok(
      events.indexOf(`snapshot:${release.tag}`) < events.indexOf(`push:${release.tag}`),
      `${release.tag} must snapshot old workflow runs before its tag push`,
    );
  }
  assert.deepEqual(
    events.filter((event) => event.startsWith("push:")),
    releases.map((release) => `push:${release.tag}`),
  );
  assert.deepEqual(events.slice(-2), [`watch:${releases.at(-1).tag}`, "cadence:release-head"]);
});

test("publishReleasePlan fault injection stops at each asynchronous boundary", async (t) => {
  const releases = readReleasePlan(fixtureRoot()).slice(0, 2);
  for (const failurePoint of ["inspect", "snapshot", "create", "push", "register", "watch", "dispatch"]) {
    await t.test(failurePoint, async () => {
      const events = [];
      const operation = async (name, release) => {
        const event = `${name}:${release?.tag ?? "cadence"}`;
        events.push(event);
        if (name === failurePoint) throw new Error(`injected ${failurePoint} failure`);
      };
      await assert.rejects(
        () =>
          publishReleasePlan(releases, {
            head: "release-head",
            watch: true,
            log: () => {},
            inspectTag: async (release) => {
              await operation("inspect", release);
              return { local: null, remote: null };
            },
            validateTag: () => {},
            listRuns: async (release) => {
              await operation("snapshot", release);
              return [];
            },
            createTag: async (release) => operation("create", release),
            pushTag: async (release) => operation("push", release),
            waitForRun: async (release) => {
              await operation("register", release);
              return { databaseId: release.tag };
            },
            watchRun: async (run) => operation("watch", { tag: run.databaseId }),
            dispatchCadence: async () => operation("dispatch"),
          }),
        new RegExp(`injected ${failurePoint} failure`),
      );

      if (
        failurePoint === "inspect" ||
        failurePoint === "snapshot" ||
        failurePoint === "create" ||
        failurePoint === "push" ||
        failurePoint === "register" ||
        failurePoint === "watch"
      ) {
        assert.equal(
          events.some((event) => event.includes(releases[1].tag)),
          false,
        );
      }
      if (failurePoint === "watch") {
        assert.equal(
          events.some((event) => event.startsWith("dispatch:")),
          false,
        );
      }
      if (failurePoint === "dispatch") {
        assert.equal(events.filter((event) => event.startsWith("watch:")).length, releases.length);
      }
    });
  }
});

test("publishReleasePlan recovers a dispatch failure without recreating or repushing tags", async () => {
  const releases = readReleasePlan(fixtureRoot());
  const events = [];
  let dispatchAttempts = 0;
  const operations = {
    head: "release-head",
    watch: true,
    log: () => {},
    inspectTag: async (release) => {
      events.push(`inspect:${release.tag}`);
      return dispatchAttempts === 0
        ? { local: null, remote: null }
        : {
            local: { commit: "release-head", annotated: true },
            remote: { commit: "release-head", annotated: true },
          };
    },
    validateTag: () => {},
    listRuns: async (release) => {
      events.push(`snapshot:${release.tag}`);
      return [];
    },
    createTag: async (release) => events.push(`create:${release.tag}`),
    pushTag: async (release) => events.push(`push:${release.tag}`),
    waitForRun: async (release) => {
      events.push(`registered:${release.tag}`);
      return { databaseId: release.tag };
    },
    watchRun: async (run) => events.push(`watch:${run.databaseId}`),
    dispatchCadence: async () => {
      dispatchAttempts += 1;
      events.push(`cadence:${dispatchAttempts}`);
      if (dispatchAttempts === 1) throw new Error("injected dispatch failure");
    },
  };

  await assert.rejects(() => publishReleasePlan(releases, operations), /injected dispatch failure/);
  await publishReleasePlan(releases, operations);

  assert.equal(events.filter((event) => event.startsWith("create:")).length, releases.length);
  assert.equal(events.filter((event) => event.startsWith("push:")).length, releases.length);
  assert.equal(events.filter((event) => event.startsWith("registered:")).length, releases.length * 2);
  assert.equal(events.filter((event) => event.startsWith("watch:")).length, releases.length * 2);
  assert.deepEqual(
    events.filter((event) => event.startsWith("cadence:")),
    ["cadence:1", "cadence:2"],
  );
});

test("publishReleasePlan resumes an existing tag without pushing it again", async () => {
  const [release] = readReleasePlan(fixtureRoot());
  const events = [];

  await publishReleasePlan([release], {
    head: "release-head",
    watch: false,
    log: () => {},
    inspectTag: async () => ({
      local: { commit: "release-head", annotated: true },
      remote: { commit: "release-head", annotated: true },
    }),
    validateTag: () => {},
    listRuns: async () => {
      throw new Error("existing remote tags must not snapshot old runs");
    },
    createTag: async () => events.push("create"),
    pushTag: async () => events.push("push"),
    waitForRun: async () => {
      events.push("registered");
      return { databaseId: 1 };
    },
    watchRun: async () => events.push("watch"),
    dispatchCadence: async () => events.push("cadence"),
  });

  assert.deepEqual(events, ["registered"]);
});

test("publishReleasePlan never watches or dispatches in no-watch mode", async () => {
  const releases = readReleasePlan(fixtureRoot());
  const events = [];
  await publishReleasePlan(releases, {
    head: "release-head",
    watch: false,
    log: () => {},
    inspectTag: async () => ({ local: null, remote: null }),
    validateTag: () => {},
    listRuns: async () => [],
    createTag: async () => {},
    pushTag: async () => {},
    waitForRun: async (release) => {
      events.push(`registered:${release.tag}`);
      return { databaseId: release.tag };
    },
    watchRun: async () => events.push("watch"),
    dispatchCadence: async () => events.push("cadence"),
  });
  assert.equal(events.length, releases.length);
  assert.equal(
    events.some((event) => event === "watch" || event === "cadence"),
    false,
  );
});

test("publishReleasePlan excludes historical runs when registering a newly pushed tag", async () => {
  const [release] = readReleasePlan(fixtureRoot());
  const historicalRun = { databaseId: 7, headBranch: release.tag, headSha: "release-head" };
  let receivedExclusions;

  await publishReleasePlan([release], {
    head: "release-head",
    watch: true,
    log: () => {},
    inspectTag: async () => ({ local: null, remote: null }),
    validateTag: () => {},
    listRuns: async () => [historicalRun],
    createTag: async () => {},
    pushTag: async () => {},
    waitForRun: async (_release, { excludeRunIds }) => {
      receivedExclusions = excludeRunIds;
      assert.equal(excludeRunIds.has("7"), true);
      return { databaseId: 8 };
    },
    watchRun: async (run) => assert.equal(run.databaseId, 8),
    dispatchCadence: async () => {},
  });

  assert.deepEqual([...receivedExclusions], ["7"]);
});

test("workflow registration selects only a fresh matching run after a new tag push", () => {
  const release = { tag: "cli-v1.0.0" };
  const head = "a".repeat(40);
  const historical = { databaseId: 7, headBranch: release.tag, headSha: head };
  const fresh = { databaseId: 8, headBranch: release.tag, headSha: head };
  const unrelated = { databaseId: 9, headBranch: "other-tag", headSha: head };

  assert.equal(selectWorkflowRun([historical], release, head, new Set(["7"])), undefined);
  assert.deepEqual(selectWorkflowRun([unrelated, historical, fresh], release, head, new Set(["7"])), fresh);
});

test("benchmark cadence dispatch pins the coordinated release commit", () => {
  const head = "a".repeat(40);
  assert.deepEqual(benchmarkCadenceDispatchArgs(head, "QVerisAI/qveris-agent-toolkit"), [
    "workflow",
    "run",
    "discover-call-cadence.yml",
    "--repo",
    "QVerisAI/qveris-agent-toolkit",
    "--ref",
    "main",
    "--field",
    `release_sha=${head}`,
  ]);
  assert.throws(
    () => benchmarkCadenceDispatchArgs("main", "QVerisAI/qveris-agent-toolkit"),
    /40-character commit SHA/,
  );
  assert.throws(() => benchmarkCadenceDispatchArgs(head), /explicit GitHub repository/);
});
