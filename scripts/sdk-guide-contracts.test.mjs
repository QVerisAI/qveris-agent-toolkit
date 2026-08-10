import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

const PYTHON_GUIDES = [
  "docs/en-US/python-sdk.md",
  "docs/zh-CN/python-sdk.md",
  "docs/cn/zh-CN/python-sdk.md",
];

const JS_GUIDES = [
  "docs/en-US/js-sdk.md",
  "docs/zh-CN/js-sdk.md",
  "docs/cn/zh-CN/js-sdk.md",
];

const PYTHON_API_REFERENCES = [
  "docs/en-US/python-sdk-api.md",
  "docs/zh-CN/python-sdk-api.md",
];

test("all Python SDK guides document the v0.6 paid-call contract", () => {
  for (const path of PYTHON_GUIDES) {
    const guide = read(path);
    for (const marker of [
      "credential_audience",
      "read_timeout",
      "call_timeout",
      "request_metadata.http_attempts == 1",
      'compatibility_mode="legacy_optional_fields"',
      "probe(tool_id",
      'compatibility_mode="strict"',
    ]) {
      assert.ok(guide.includes(marker), `${path} is missing ${marker}`);
    }
  }
});

test("all TypeScript SDK guides document Probe and strict paid calls", () => {
  for (const path of JS_GUIDES) {
    const guide = read(path);
    for (const marker of [
      "probe(toolId, options?)",
      "probe(toolId, { parameters?, checks?, liveBudget?, timeoutMs? })",
      "compatibilityMode: 'legacyOptionalFields'",
      "single-submit",
    ]) {
      assert.ok(guide.includes(marker), `${path} is missing ${marker}`);
    }
  }
});

test("all TypeScript SDK guides describe API key authentication as conditional", () => {
  const requiredWithoutCredentialProvider = {
    "docs/en-US/js-sdk.md": "— (required without `credentialProvider`)",
    "docs/zh-CN/js-sdk.md": "—（未提供 `credentialProvider` 时必填）",
    "docs/cn/zh-CN/js-sdk.md": "—（未提供 `credentialProvider` 时必填）",
  };

  for (const [path, expectation] of Object.entries(requiredWithoutCredentialProvider)) {
    const guide = read(path);
    assert.ok(
      guide.includes(`| \`apiKey\` | \`QVERIS_API_KEY\` | ${expectation} |`),
      `${path} must describe apiKey as conditional on credentialProvider`,
    );
  }
});

test("generated Python API references document public Probe response models", () => {
  for (const path of PYTHON_API_REFERENCES) {
    const reference = read(path);
    for (const model of [
      "ProbeSchemaViolation",
      "ProbeSchemaResult",
      "ProbeQuoteResult",
      "ProbeUnknownResult",
      "ToolProbeResponse",
    ]) {
      assert.ok(
        reference.includes(`<a id="qveris.${model}"></a>`),
        `${path} is missing ${model}`,
      );
    }
    assert.match(
      reference,
      /probe\([^)]*\) → \[ToolProbeResponse\]\(#qveris\.ToolProbeResponse\)/,
      `${path} does not link probe() to ToolProbeResponse`,
    );
  }
});

test("China SDK guides keep the China endpoint boundary", () => {
  const guides = [
    ["docs/cn/zh-CN/python-sdk.md", "python-sdk-api.md"],
    ["docs/cn/zh-CN/js-sdk.md", "js-sdk-api.md"],
  ];

  for (const [path, unavailableReference] of guides) {
    const guide = read(path);
    assert.ok(guide.includes("https://qveris.cn/api/v1"), `${path} is missing the China API endpoint`);
    assert.ok(!guide.includes("qveris.ai"), `${path} crosses the public deployment boundary`);
    assert.ok(
      !guide.includes(`](${unavailableReference})`),
      `${path} links to a global-only API reference`,
    );
  }
});
