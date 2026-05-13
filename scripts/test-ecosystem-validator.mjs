#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VALIDATOR = path.join(REPO_ROOT, "scripts/validate-ecosystem-manifests.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qveris-manifest-validator-"));

const tests = [
  ["accepts valid recipe manifest", testValidManifest],
  ["rejects missing required recipe permission", testMissingInspectPermission],
  ["rejects missing docs path", testMissingDocsPath],
  ["rejects invalid marketplace integration method", testInvalidIntegrationMethod],
  ["rejects unsupported schema version", testUnsupportedSchemaVersion],
  ["rejects missing example path", testMissingExamplePath],
];

try {
  for (const [name, testFn] of tests) {
    testFn();
    console.log(`ok ${name}`);
  }
  console.log(`\n${tests.length} validator regression test(s) passed.`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function testValidManifest() {
  const manifestPath = writeFixture("valid");
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 0);
  assert.match(result.stdout, /Validated 1 ecosystem manifest\(s\)\./);
}

function testMissingInspectPermission() {
  const manifestPath = writeFixture("missing-inspect", (manifest) => {
    manifest.permissions.qveris = manifest.permissions.qveris.filter(
      (permission) => permission.scope !== "capability.inspect",
    );
  });
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 1);
  assert.match(result.stderr, /recipe manifests must declare capability\.inspect/);
}

function testMissingDocsPath() {
  const manifestPath = writeFixture("missing-docs", (manifest) => {
    manifest.docs.readme = "MISSING.md";
  });
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 1);
  assert.match(result.stderr, /docs\.readme path does not exist: MISSING\.md/);
}

function testInvalidIntegrationMethod() {
  const manifestPath = writeFixture("invalid-method", (manifest) => {
    manifest.marketplace.integration_methods = ["cli", "spreadsheet"];
  });
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 1);
  assert.match(result.stderr, /marketplace\.integration_methods has unsupported value: spreadsheet/);
}

function testUnsupportedSchemaVersion() {
  const manifestPath = writeFixture("bad-schema-version", (manifest) => {
    manifest.schema_version = "2026-01-01";
  });
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 1);
  assert.match(result.stderr, /schema_version must be 2026-05-13/);
}

function testMissingExamplePath() {
  const manifestPath = writeFixture("missing-example", (manifest) => {
    manifest.examples[0].path = "missing-example.md";
  });
  const result = runValidator(manifestPath);
  assertEqualStatus(result, 1);
  assert.match(result.stderr, /examples\[0\]\.path does not exist: missing-example\.md/);
}

function runValidator(manifestPath) {
  return spawnSync(process.execPath, [VALIDATOR, manifestPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function writeFixture(name, mutate = () => {}) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), `# ${name}\n`, "utf8");

  const manifest = validManifest();
  manifest.id = `qveris.recipe.${name}`;
  manifest.marketplace.listing_slug = name;
  mutate(manifest);

  const manifestPath = path.join(dir, "qveris.manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function assertEqualStatus(result, expected) {
  assert.equal(
    result.status,
    expected,
    [
      `Expected exit status ${expected}, got ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n\n"),
  );
}

function validManifest() {
  return {
    "$schema": "../../ecosystem/manifest.schema.json",
    schema_version: "2026-05-13",
    id: "qveris.recipe.valid",
    kind: "recipe",
    name: "Valid Recipe",
    summary: "A valid recipe manifest used by the validator regression tests.",
    description:
      "This manifest exercises the validator success path with complete permissions, docs, examples, compatibility, and marketplace metadata.",
    version: "0.1.0",
    status: "beta",
    owner: {
      name: "QVeris",
      url: "https://qveris.ai",
    },
    tags: ["test", "recipe"],
    categories: ["automation"],
    permissions: {
      qveris: [
        {
          scope: "capability.discover",
          reason: "Find external capabilities for this recipe.",
          required: true,
        },
        {
          scope: "capability.inspect",
          reason: "Inspect candidate capability metadata before execution.",
          required: true,
        },
      ],
      network: [
        {
          host: "qveris.ai",
          reason: "Call QVeris API endpoints.",
          required: true,
        },
      ],
      secrets: [
        {
          scope: "QVERIS_API_KEY",
          reason: "Authenticate QVeris API requests.",
          required: true,
        },
      ],
    },
    compatibility: {
      cli: ">=0.5.0",
      python_sdk: ">=0.1.0",
    },
    marketplace: {
      listing_slug: "valid",
      headline: "Valid manifest fixture for validator regression coverage.",
      audience: "Maintainers who need confidence in ecosystem manifest validation.",
      use_cases: ["Validate complete recipe metadata", "Catch permission and listing mistakes"],
      integration_methods: ["cli", "python-sdk"],
      primary_cta: "Run test",
      docs_url: "recipes/valid/README.md",
    },
    docs: {
      readme: "README.md",
    },
    examples: [
      {
        name: "CLI example",
        path: "README.md",
        language: "shell",
        command: "qveris discover \"example capability\" --limit 3",
      },
    ],
  };
}
