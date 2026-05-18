// Issue #37 phase 3 (#47): CLI is JavaScript/MJS, so before any type
// generation it gets contract tests that assert every endpoint + method the
// CLI actually calls exists in the website-mirrored public OpenAPI spec.
// This catches CLI/contract drift without introducing a generator.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(
  here,
  "../../../docs/openapi/qveris-public-api.openapi.json",
);

const spec = JSON.parse(readFileSync(specPath, "utf8"));

// Endpoints the CLI calls today, kept in sync with packages/cli/src/client/api.mjs.
// (path, method) — method lowercased to match OpenAPI operation keys.
const CLI_OPERATIONS = [
  ["/search", "post"],
  ["/tools/by-ids", "post"],
  ["/tools/execute", "post"],
  ["/auth/credits", "get"],
  ["/auth/usage/history/v2", "get"],
  ["/auth/credits/ledger", "get"],
];

test("OpenAPI spec is structurally usable", () => {
  assert.equal(typeof spec, "object");
  assert.ok(spec.info && typeof spec.info.version === "string", "info.version present");
  assert.ok(spec.paths && typeof spec.paths === "object", "paths present");
});

for (const [p, method] of CLI_OPERATIONS) {
  test(`contract covers CLI call ${method.toUpperCase()} ${p}`, () => {
    const item = spec.paths[p];
    assert.ok(item, `path ${p} missing from public OpenAPI contract`);
    assert.ok(
      item[method],
      `method ${method.toUpperCase()} for ${p} missing — CLI calls it but the contract does not declare it`,
    );
  });
}
