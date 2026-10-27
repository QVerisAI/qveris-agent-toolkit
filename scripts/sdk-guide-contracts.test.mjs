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

const GETTING_STARTED_GUIDES = [
  "docs/en-US/getting-started.md",
  "docs/zh-CN/getting-started.md",
  "docs/cn/zh-CN/getting-started.md",
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
      "probe(toolId, { parameters?, checks?, liveBudget?, subUserId?, timeoutMs? })",
      "compatibilityMode: 'legacyOptionalFields'",
      "single-submit",
    ]) {
      assert.ok(guide.includes(marker), `${path} is missing ${marker}`);
    }
  }
});

test("SDK quickstarts validate parameter types and enums before selecting a candidate", () => {
  for (const path of [...JS_GUIDES, ...GETTING_STARTED_GUIDES]) {
    const guide = read(path);
    for (const marker of ["matchesType", "Number.isFinite", "parameter.enum", "Object.is"]) {
      assert.ok(guide.includes(marker), `${path} is missing ${marker}`);
    }
  }
  for (const path of [...PYTHON_GUIDES, ...GETTING_STARTED_GUIDES]) {
    const guide = read(path);
    for (const marker of ["matches_type", "math.isfinite", "p.enum", "isinstance(allowed, bool)"]) {
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

test("published onboarding starts with one authenticated Discover before optional Call examples", () => {
  for (const path of GETTING_STARTED_GUIDES) {
    const guide = read(path).replaceAll("\r\n", "\n");
    const python = guide.match(/```python\n([\s\S]*?)```/)?.[1];
    const typescript = guide.match(/```typescript\n([\s\S]*?)```/)?.[1];
    assert.ok(python?.includes("QverisConfig(base_url="), `${path}: use the released authenticated client`);
    assert.ok(python?.includes("await client.discover("), `${path}: first Python request is Discover`);
    assert.doesNotMatch(python, /\.call\(|\bAgent\(|OPENAI_API_KEY/);
    assert.ok(typescript?.includes("Qveris.fromEnv("), `${path}: use the released credential path`);
    assert.ok(typescript?.includes("await qveris.discover("), `${path}: first TypeScript request is Discover`);
    assert.doesNotMatch(typescript, /\.call\(/);
    const hosted = JSON.parse(guide.match(/```json\n([\s\S]*?)```/)?.[1]);
    assert.ok(hosted.mcpServers.qveris.url.endsWith("/mcp"), `${path}: default OAuth endpoint`);
    assert.equal(hosted.mcpServers.qveris.headers, undefined, `${path}: do not require pasted secrets for OAuth`);
    assert.ok(guide.includes("public-readonly"), `${path}: explicit public REST is separate`);
    assert.ok(guide.includes("0.11.3") && guide.includes("0.9.0") && guide.includes("0.8.0"));
    assert.doesNotMatch(guide, /qveris auth trial|--public-readonly|--readonly|--read-only/);
    assert.ok(!guide.includes(path.includes("/cn/") ? "qveris.ai" : "qveris.cn"), `${path}: own site only`);
  }
});


test("canonical CLI quickstarts keep OAuth-first Discover separate from guided Call", () => {
  for (const locale of ["en-US", "zh-CN", "cn/zh-CN"]) {
    const guide = read(`docs/${locale}/cli.md`).replaceAll("\r\n", "\n");
    const title = locale === "en-US" ? "## Quick Start" : "## 快速开始";
    const quickstart = guide.slice(guide.indexOf(title)).split("\n---")[0];
    const shell = quickstart.match(/```bash\n([\s\S]*?)```/)?.[1];
    assert.ok(shell?.includes("qveris auth login"));
    assert.ok(shell?.includes("qveris discover") && shell.includes("--json"));
    assert.doesNotMatch(shell, /qveris (?:call|init|auth trial)|--public-readonly|--readonly|--read-only/);
  }
});

test("explicit public client guides preserve restricted identity and upgrade boundaries", () => {
  for (const locale of ["en-US", "zh-CN", "cn/zh-CN"]) {
    const en = locale === "en-US";
    for (const family of ["cli", "js-sdk", "python-sdk"]) {
      const path = `docs/${locale}/${family}.md`;
      const guide = read(path).replaceAll("\r\n", "\n");
      const title = en ? "## Explicit public read-only discovery" : "## 显式公开只读发现";
      const start = guide.indexOf(title);
      assert.ok(start > 0, `${path}: explicit mode is separate from default setup`);
      const end = guide.indexOf("\n## ", start + title.length);
      const section = guide.slice(start, end < 0 ? undefined : end);
      assert.ok(section.includes("Retry-After") && section.includes("401") && section.includes("429"));
      assert.ok(section.includes("pub_") && section.includes("/docs/rest-api"));
      assert.ok(!section.includes(locale.startsWith("cn/") ? "qveris.ai" : "qveris.cn"));
      assert.match(section, en ? /without.*old public search/i : /不携带.*旧公开 search/);
      assert.doesNotMatch(section, /QVERIS_REGION|SITE_REGION|qveris auth trial/);
      if (family === "cli") {
        assert.ok(section.includes("0.12.0") && section.includes("--public-read-only"));
        assert.match(section, en ? /OAuth session or trial credential/ : /OAuth 会话或试用凭据/);
      } else if (family === "js-sdk") {
        assert.ok(section.includes("0.10.0") && section.includes("Qveris.publicReadOnly("));
        assert.ok(section.includes("if (found.results.length > 0)"));
      } else {
        assert.ok(section.includes("0.9.0") && section.includes("async with PublicDiscoveryClient(config)"));
        assert.ok(section.includes("QVERIS_API_KEY") && section.includes("if found.results:"));
      }
    }
  }
});
