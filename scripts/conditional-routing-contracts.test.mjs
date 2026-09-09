import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function normalizeSourceText(source) {
  return source.replace(/["'`+]/g, '').replace(/\s+/g, ' ');
}

const ENGLISH_GUIDANCE = [
  'README.md',
  'agent/GUIDELINES.md',
  'agent/SETUP.md',
  'agent/llms.txt',
  'agent/llms-full.txt',
  'skills/qveris/SKILL.md',
  'skills/qveris-cli/SKILL.md',
  'docs/en-US/getting-started.md',
  'docs/en-US/cli.md',
  'docs/en-US/cookbook.md',
  'docs/en-US/mcp-server.md',
  'docs/en-US/rest-api.md',
  'docs/en-US/js-sdk.md',
  'docs/en-US/python-sdk.md',
  'recipes/explainable-routing/README.md',
  'packages/cli/README.md',
  'packages/mcp/README.md',
  'packages/js-sdk/README.md',
  'packages/python-sdk/README.md',
];

const LIMITED_TOOL_GUIDANCE = ['packages/openclaw-qveris-plugin/README.md'];

const CHINESE_GUIDANCE = [
  'README_zh-CN.md',
  'docs/zh-CN/getting-started.md',
  'docs/zh-CN/cli.md',
  'docs/zh-CN/cookbook.md',
  'docs/zh-CN/mcp-server.md',
  'docs/zh-CN/rest-api.md',
  'docs/zh-CN/js-sdk.md',
  'docs/zh-CN/python-sdk.md',
  'docs/cn/zh-CN/getting-started.md',
  'docs/cn/zh-CN/cli.md',
  'docs/cn/zh-CN/cookbook.md',
  'docs/cn/zh-CN/mcp-server.md',
  'docs/cn/zh-CN/rest-api.md',
  'docs/cn/zh-CN/js-sdk.md',
  'docs/cn/zh-CN/python-sdk.md',
];

const PROBE_RUNTIME_DESCRIPTIONS = ['packages/mcp/src/index.ts'];

const LIMITED_RUNTIME_DESCRIPTIONS = [
  'packages/js-sdk/src/integrations/ai.ts',
  'packages/python-sdk/qveris/client/tools.py',
  'packages/python-sdk/qveris/integrations/_workflow.py',
  'packages/openclaw-qveris-plugin/src/qveris-tools.ts',
];

const RUNNABLE_EXAMPLES = [
  'packages/cli/examples/discover-inspect-call.sh',
  'packages/mcp/examples/agent-loop.ts',
  'packages/js-sdk/examples/quickstart.ts',
  'packages/python-sdk/examples/_shared.py',
  'packages/python-sdk/examples/explainable_routing.py',
  'recipes/explainable-routing/run.sh',
];

const MODEL_DRIVEN_EXAMPLES = [
  'packages/python-sdk/examples/autogen_integration.py',
  'packages/python-sdk/examples/crewai_integration.py',
  'packages/python-sdk/examples/llamaindex_integration.py',
  'packages/python-sdk/examples/openai_agents_integration.py',
  'packages/python-sdk/examples/pydantic_ai_integration.py',
];

const CONTRACT_SHAPE_GUIDANCE = [
  'agent/GUIDELINES.md',
  'skills/qveris-cli/SKILL.md',
  'docs/en-US/rest-api.md',
  'docs/en-US/js-sdk.md',
  'docs/en-US/python-sdk.md',
  'docs/zh-CN/js-sdk.md',
  'docs/zh-CN/python-sdk.md',
  'docs/cn/zh-CN/js-sdk.md',
  'docs/cn/zh-CN/python-sdk.md',
];

const UNKNOWN_OUTCOME_GUIDANCE = [
  'agent/GUIDELINES.md',
  'skills/qveris/SKILL.md',
  'skills/qveris-cli/SKILL.md',
  'packages/openclaw-qveris-plugin/README.md',
  'docs/zh-CN/rest-api.md',
  'docs/cn/zh-CN/rest-api.md',
];

function assertEnglishPolicy(path) {
  const source = normalizeSourceText(read(path));
  assert.match(
    source,
    /For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation\./i,
    `${path} is missing the provider-comparison inspection rule`,
  );
  assert.match(
    source,
    /Probe every candidate when the comparison requires a current quote\./i,
    `${path} is missing the provider-comparison quote rule`,
  );
  assert.match(
    source,
    /Reuse may preserve an exact route, never business parameters or results:/i,
    `${path} is missing the route-only reuse boundary`,
  );
  assert.match(
    source,
    /make a fresh Call for current, latest, today, or other time-sensitive data\./i,
    `${path} is missing the fresh-call rule`,
  );
}

function assertChinesePolicy(path) {
  const source = normalizeSourceText(read(path));
  assert.match(
    source,
    /进行 Provider 比较时，如果需要确认当前范围或完整契约，必须逐一 Inspect；Discover 摘要不等于确认。/,
    `${path} 缺少 Provider 比较检查规则`,
  );
  assert.match(source, /比较需要当前报价时，必须逐一 Probe。/, `${path} 缺少 Provider 比较报价规则`);
  assert.match(source, /复用只能保留精确路由，不能保留业务参数或结果：/, `${path} 缺少仅复用路由的边界`);
  assert.match(source, /当前、最新、今天或其他时效性数据必须执行新的 Call。/, `${path} 缺少实时数据重新 Call 规则`);
}

function assertRuntimePolicy(path) {
  const source = normalizeSourceText(read(path));
  assert.match(
    source,
    /Provider comparison: Inspect each candidate to confirm current scope\/contracts; Probe each when current quotes are required\./i,
    `${path} is missing the compact provider-comparison rule`,
  );
  assert.match(
    source,
    /Reuse only exact routes; rebuild current parameters and Call again for current\/latest\/today\/time-sensitive data\./i,
    `${path} is missing the compact fresh-call rule`,
  );
}

function assertLimitedToolPolicy(path) {
  const source = normalizeSourceText(read(path));
  assert.match(
    source,
    /(?:Provider comparison: Inspect each candidate to confirm current scope\/contracts|For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation)\./i,
    `${path} is missing the compact provider-comparison rule`,
  );
  assert.match(
    source,
    /If a budget decision requires a current Probe cost quote, do not Call until the host obtains it; this three-tool (?:adapter|integration|plugin) does not expose Probe\./i,
    `${path} must stop when a required Probe cost quote is unavailable`,
  );
  assert.match(
    source,
    /(?:This|This restriction) does not apply to fresh business data such as a stock quote; obtain that with Call\./i,
    `${path} must distinguish Probe cost quotes from fresh business data`,
  );
  assert.match(
    source,
    /Reuse only exact routes; rebuild current parameters and Call again for current\/latest\/today\/time-sensitive data\./i,
    `${path} is missing the compact fresh-call rule`,
  );
}

test('all maintained English guidance preserves the conditional-routing safety capsule', () => {
  for (const path of ENGLISH_GUIDANCE) assertEnglishPolicy(path);
});

test('all maintained Chinese guidance preserves the conditional-routing safety capsule', () => {
  for (const path of CHINESE_GUIDANCE) assertChinesePolicy(path);
});

test('runtime tool descriptions expose the same routing boundaries to models', () => {
  for (const path of PROBE_RUNTIME_DESCRIPTIONS) assertRuntimePolicy(path);
  for (const path of LIMITED_RUNTIME_DESCRIPTIONS) assertLimitedToolPolicy(path);
});

test('runnable examples teach the same provider-comparison and fresh-call behavior', () => {
  for (const path of RUNNABLE_EXAMPLES) assertEnglishPolicy(path);
  for (const path of MODEL_DRIVEN_EXAMPLES) assertLimitedToolPolicy(path);
});

test('explainable-routing examples inspect every compared candidate before selection', () => {
  const python = normalizeSourceText(read('packages/python-sdk/examples/explainable_routing.py'));
  const shell = normalizeSourceText(read('recipes/explainable-routing/run.sh'));

  assert.match(
    python,
    /client\.inspect\( \[tool\.tool_id for tool in discovered\.results\], search_id=discovered\.search_id,/,
    'Python explainable routing must inspect every discovered candidate',
  );
  assert.ok(
    python.indexOf('client.inspect(') < python.indexOf('selected, reason = choose(compatible)'),
    'Python explainable routing must inspect before selection',
  );
  assert.match(
    shell,
    /inspect \$\{tool_ids\[@\]\} --discovery-id \$search_id --json/,
    'CLI explainable routing must inspect every discovered candidate',
  );
  assert.ok(
    shell.indexOf(' inspect ${tool_ids[@]} ') < shell.indexOf('choice=$(jq'),
    'CLI explainable routing must inspect before selection',
  );
});

test('limited-tool guidance stops when Probe is unavailable', () => {
  for (const path of LIMITED_TOOL_GUIDANCE) assertLimitedToolPolicy(path);
});

test('contract-shape and unknown-outcome guidance preserve execution boundaries', () => {
  for (const path of CONTRACT_SHAPE_GUIDANCE) {
    const source = normalizeSourceText(read(path));
    assert.match(source, /explicit(?:ly)? empty|显式空参数/, `${path} must identify an explicitly empty contract`);
    assert.match(source, /omitted|缺少参数|缺失.*契约/, `${path} must identify an omitted contract`);
    assert.match(
      source,
      /zero-parameter|takes no parameters|无参数/,
      `${path} must preserve zero-parameter capabilities`,
    );
    assert.match(source, /Inspect/i, `${path} must inspect an omitted contract before Call`);
  }

  for (const path of UNKNOWN_OUTCOME_GUIDANCE) {
    const source = normalizeSourceText(read(path));
    assert.match(source, /unknown execution outcome|执行结果未知|未知执行/, `${path} must identify an unknown outcome`);
    assert.match(
      source,
      /(?:never|must not|do not|不得|不要).*?(?:repeat|replay|重放|重复)/i,
      `${path} must prohibit replay after an unknown outcome`,
    );
  }
});

test('guidance does not promise unsafe reuse or unconditional direct calls', () => {
  for (const path of [
    ...ENGLISH_GUIDANCE,
    ...LIMITED_TOOL_GUIDANCE,
    ...PROBE_RUNTIME_DESCRIPTIONS,
    ...LIMITED_RUNTIME_DESCRIPTIONS,
    ...RUNNABLE_EXAMPLES,
    ...MODEL_DRIVEN_EXAMPLES,
  ]) {
    const source = normalizeSourceText(read(path));
    assert.doesNotMatch(
      source,
      /reuse (?:a |the )?(?:previous|cached) business result/i,
      `${path} permits cached business-result reuse`,
    );
    assert.doesNotMatch(
      source,
      /always (?:go|call|proceed) directly from Discover to Call/i,
      `${path} requires an unconditional direct Call`,
    );
    assert.doesNotMatch(
      source,
      /Probe (?:is|as) (?:a )?(?:mandatory|required) (?:step|stage|prerequisite)|always (?:use|run|call) Probe|must Probe before (?:every|any) Call|Probe (?:is )?required before (?:every|any) Call/i,
      `${path} makes Probe mandatory`,
    );
    assert.doesNotMatch(
      source,
      /(?:enable|use|support) (?:fuzzy|semantic) (?:matching|routing|reuse)|(?:enable|use|support) cross-session (?:memory|reuse)|reuse (?:similar|semantically related) (?:queries|intents)|persist (?:routes|capabilities) across sessions/i,
      `${path} permits fuzzy or cross-session reuse`,
    );
    assert.doesNotMatch(
      source,
      /Probe quote (?:is|provides) (?:a )?(?:guaranteed|final|reserved) price|Probe guarantees (?:the )?(?:price|cost)|Probe (?:locks|reserves) (?:the )?(?:price|cost)/i,
      `${path} treats a Probe quote as a guaranteed price`,
    );
  }
});
