import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CLIENTS, extractChangelogRelease, publishReleasePlan, readReleasePlan } from "./release-client-packages.mjs";

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

test("publishReleasePlan pushes one tag at a time and confirms each run before the next push", async () => {
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
    createTag: async (release) => events.push(`create:${release.tag}`),
    pushTag: async (release) => events.push(`push:${release.tag}`),
    waitForRun: async (release) => {
      events.push(`registered:${release.tag}`);
      return { databaseId: release.tag };
    },
    watchRun: async (run) => events.push(`watch:${run.databaseId}`),
  });

  assert.equal(runs.length, 4);
  for (let index = 0; index < releases.length - 1; index += 1) {
    assert.ok(
      events.indexOf(`registered:${releases[index].tag}`) < events.indexOf(`push:${releases[index + 1].tag}`),
      `${releases[index].tag} must register before the next tag push`,
    );
  }
  assert.deepEqual(
    events.filter((event) => event.startsWith("push:")),
    releases.map((release) => `push:${release.tag}`),
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
    createTag: async () => events.push("create"),
    pushTag: async () => events.push("push"),
    waitForRun: async () => {
      events.push("registered");
      return { databaseId: 1 };
    },
    watchRun: async () => events.push("watch"),
  });

  assert.deepEqual(events, ["registered"]);
});
