#!/usr/bin/env node

// Regression tests for scripts/validate-openapi-contract.mjs.
// Runs the validator as a subprocess against the real spec and against
// deliberately broken temp copies.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = path.join(REPO_ROOT, "scripts/validate-openapi-contract.mjs");
const REAL_SPEC = path.join(REPO_ROOT, "docs/openapi/qveris-public-api.openapi.json");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qveris-openapi-contract-"));

function run(specPath) {
  return spawnSync(process.execPath, [VALIDATOR, specPath], { encoding: "utf8" });
}

function writeSpec(name, mutate) {
  const spec = JSON.parse(fs.readFileSync(REAL_SPEC, "utf8"));
  mutate(spec);
  const target = path.join(tmpRoot, name);
  fs.writeFileSync(target, JSON.stringify(spec));
  return target;
}

const tests = [
  ["accepts the real checked-in spec", () => {
    const result = run(REAL_SPEC);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OpenAPI contract OK/);
  }],
  ["rejects a missing file", () => {
    const result = run(path.join(tmpRoot, "does-not-exist.json"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not found/);
  }],
  ["rejects invalid JSON", () => {
    const target = path.join(tmpRoot, "broken.json");
    fs.writeFileSync(target, "{ not json");
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
  }],
  ["rejects valid JSON that is not an object", () => {
    const target = path.join(tmpRoot, "null.json");
    fs.writeFileSync(target, "null");
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a valid OpenAPI object/);
  }],
  ["rejects missing info.version", () => {
    const target = writeSpec("no-version.json", (spec) => {
      delete spec.info.version;
    });
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /info\.version/);
  }],
  ["rejects a missing core path", () => {
    const target = writeSpec("no-search.json", (spec) => {
      delete spec.paths["/search"];
    });
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required path: \/search/);
  }],
  ["rejects a missing component schema", () => {
    const target = writeSpec("no-schema.json", (spec) => {
      delete spec.components.schemas.PublicSearchResponse;
    });
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required component schema: PublicSearchResponse/);
  }],
  ["accepts the broadened inline params contract without the legacy component", () => {
    const target = writeSpec("broad-params.json", (spec) => {
      spec.components.schemas.PublicCapabilityResult.properties.params = {
        type: ["object", "array", "string", "number", "boolean", "null"],
      };
      delete spec.components.schemas.PublicToolParameter;
    });
    const result = run(target);
    assert.equal(result.status, 0, result.stderr);
  }],
  ["rejects a missing component still referenced by legacy params", () => {
    const target = writeSpec("missing-parameter-schema.json", (spec) => {
      spec.components.schemas.PublicCapabilityResult.properties.params = {
        type: "array",
        items: { $ref: "#/components/schemas/PublicToolParameter" },
      };
      delete spec.components.schemas.PublicToolParameter;
    });
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing referenced component schema: PublicToolParameter/);
  }],
  ["rejects an incomplete JSON-value params union", () => {
    const target = writeSpec("incomplete-params-union.json", (spec) => {
      spec.components.schemas.PublicCapabilityResult.properties.params = {
        type: ["object", "array", "string", "null"],
      };
      delete spec.components.schemas.PublicToolParameter;
    });
    const result = run(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JSON-value union is missing: number, boolean/);
  }],
];

try {
  for (const [name, testFn] of tests) {
    testFn();
    console.log(`ok ${name}`);
  }
  console.log(`\n${tests.length} OpenAPI contract regression test(s) passed.`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
