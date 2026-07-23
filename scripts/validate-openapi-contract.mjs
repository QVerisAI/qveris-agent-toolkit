#!/usr/bin/env node

// Issue #37 Phase 1: validate the mirrored public OpenAPI contract.
//
// The private documentation source owns the public REST contract and mirrors
// docs/openapi/qveris-public-api.openapi.json into this repo. This script is
// a zero-dependency drift check: it fails CI when the checked-in contract is
// missing the version, the core paths, or the response schemas the toolkit
// (CLI / MCP / Python SDK) depends on. It does NOT generate types — that is
// Phase 2 of the issue and ships as a separate PR.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SPEC = path.join("docs", "openapi", "qveris-public-api.openapi.json");

// Core agent-path endpoints the toolkit calls. Listed in the issue.
const REQUIRED_PATHS = [
  "/search",
  "/tools/by-ids",
  "/tools/execute",
  "/auth/usage/history/v2",
  "/auth/credits/ledger",
];

// Response/component schemas the toolkit clients deserialize. Keeping this
// list intentionally focused on what the toolkit consumes so the check
// catches contract drift without being brittle to unrelated backend schemas.
const REQUIRED_SCHEMAS = [
  "PublicSearchResponse",
  "PublicCapabilityResult",
  "PublicToolParameter",
  "PublicToolStats",
  "PublicBillingRule",
  "PublicExecuteToolResponse",
  "PublicCompactBillingStatement",
  "APIResponse_UsageEventsResponse_",
  "UsageEventsResponse",
  "UsageEventItem",
  "APIResponse_CreditsLedgerResponse_",
  "CreditsLedgerResponse",
  "CreditsLedgerItem",
];

function fail(errors) {
  console.error("OpenAPI contract validation FAILED:");
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    "\nThe public OpenAPI contract is mirrored from the documentation source. " +
      "If this drift is intentional, re-mirror the spec; otherwise the backend contract changed."
  );
  process.exit(1);
}

function main() {
  const specArg = process.argv[2];
  const specPath = path.resolve(REPO_ROOT, specArg || DEFAULT_SPEC);
  const rel = path.relative(REPO_ROOT, specPath);
  const errors = [];

  if (!fs.existsSync(specPath)) {
    fail([`OpenAPI file not found: ${rel}`]);
    return;
  }

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  } catch (error) {
    fail([`${rel} is not valid JSON: ${error.message}`]);
    return;
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    fail([`${rel} is not a valid OpenAPI object`]);
    return;
  }

  if (typeof spec.openapi !== "string" || !spec.openapi) {
    errors.push("missing top-level `openapi` version string");
  }

  const infoVersion = spec.info && spec.info.version;
  if (typeof infoVersion !== "string" || !infoVersion.trim()) {
    errors.push("missing `info.version`");
  }

  const paths = spec.paths && typeof spec.paths === "object" ? spec.paths : {};
  for (const required of REQUIRED_PATHS) {
    if (!Object.prototype.hasOwnProperty.call(paths, required)) {
      errors.push(`missing required path: ${required}`);
    }
  }

  const schemas =
    spec.components && spec.components.schemas && typeof spec.components.schemas === "object"
      ? spec.components.schemas
      : {};
  for (const required of REQUIRED_SCHEMAS) {
    if (!Object.prototype.hasOwnProperty.call(schemas, required)) {
      errors.push(`missing required component schema: ${required}`);
    }
  }

  if (errors.length > 0) {
    fail(errors);
    return;
  }

  console.log(`OpenAPI contract OK: ${rel}`);
  console.log(`  openapi: ${spec.openapi}`);
  console.log(`  info.version: ${infoVersion}`);
  console.log(`  paths checked: ${REQUIRED_PATHS.length}`);
  console.log(`  schemas checked: ${REQUIRED_SCHEMAS.length}`);
}

main();
