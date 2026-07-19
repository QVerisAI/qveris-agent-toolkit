import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKAGE_PREFIXES = {
  benchmark: ['benchmarks/discover-call/'],
  cli: ['packages/cli/'],
  python: ['packages/python-sdk/'],
  js: ['packages/js-sdk/'],
  mcp: ['packages/mcp/'],
  plugin: ['packages/openclaw-qveris-plugin/'],
};

const ALL_TARGETS = Object.keys(PACKAGE_PREFIXES);
const OPENAPI_TARGETS = ['cli', 'python', 'js', 'mcp'];
const PLANNER_FILES = new Set([
  '.github/workflows/contract-tests.yml',
  'package.json',
  'package-lock.json',
  'scripts/plan-contract-tests.mjs',
  'scripts/plan-contract-tests.test.mjs',
]);
const SHARED_LINT_FILES = new Set(['.prettierrc.json', '.prettierignore']);
const LINT_PACKAGE_NAMES = {
  cli: 'cli',
  'python-sdk': 'python',
  'js-sdk': 'js',
  mcp: 'mcp',
  'openclaw-qveris-plugin': 'plugin',
};

export function classifyContractChanges(files, { full = false } = {}) {
  const normalized = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
  const selected = new Set(full ? ALL_TARGETS : []);
  const packageTargets = ['cli', 'python', 'js', 'mcp', 'plugin'];
  const lintTargets = new Set(full ? packageTargets : []);

  for (const file of normalized) {
    if (PLANNER_FILES.has(file)) {
      ALL_TARGETS.forEach((target) => selected.add(target));
      continue;
    }

    if (file.startsWith('docs/openapi/')) {
      OPENAPI_TARGETS.forEach((target) => selected.add(target));
    }

    if (SHARED_LINT_FILES.has(file)) {
      packageTargets.forEach((target) => lintTargets.add(target));
    }

    const eslintPackage = file.match(/^packages\/([^/]+)\/eslint\.config\.mjs$/)?.[1];
    if (eslintPackage && LINT_PACKAGE_NAMES[eslintPackage]) {
      lintTargets.add(LINT_PACKAGE_NAMES[eslintPackage]);
    }

    for (const [target, prefixes] of Object.entries(PACKAGE_PREFIXES)) {
      if (prefixes.some((prefix) => file.startsWith(prefix))) selected.add(target);
    }
  }

  packageTargets.filter((target) => selected.has(target)).forEach((target) => lintTargets.add(target));
  return {
    benchmark: selected.has('benchmark'),
    cli: selected.has('cli'),
    python: selected.has('python'),
    js: selected.has('js'),
    mcp: selected.has('mcp'),
    plugin: selected.has('plugin'),
    lint: lintTargets.size > 0,
    lint_cli: lintTargets.has('cli'),
    lint_python: lintTargets.has('python'),
    lint_js: lintTargets.has('js'),
    lint_mcp: lintTargets.has('mcp'),
    lint_plugin: lintTargets.has('plugin'),
    examples: selected.has('cli'),
    os_matrix: full ? ['ubuntu-latest', 'windows-latest'] : ['ubuntu-latest'],
  };
}

function changedFiles(baseSha, headSha) {
  if (!baseSha || !headSha) throw new Error('CONTRACT_TEST_BASE_SHA and CONTRACT_TEST_HEAD_SHA are required');
  return execFileSync('git', ['diff', '--name-only', `${baseSha}...${headSha}`, '--'], {
    encoding: 'utf8',
  }).split('\n');
}

export function resolveContractPlan({
  full = false,
  baseSha,
  headSha,
  diff = changedFiles,
  onFallback = () => {},
} = {}) {
  let effectiveFull = full;
  let files = [];

  if (!effectiveFull) {
    try {
      files = diff(baseSha, headSha);
    } catch (error) {
      effectiveFull = true;
      onFallback(error);
    }
  }

  return {
    full: effectiveFull,
    files: files.filter(Boolean),
    plan: classifyContractChanges(files, { full: effectiveFull }),
  };
}

function writeOutputs(plan, outputPath) {
  const lines = Object.entries(plan).map(([key, value]) => {
    const serialized = Array.isArray(value) ? JSON.stringify(value) : String(value);
    return `${key}=${serialized}`;
  });
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const result = resolveContractPlan({
    full: process.env.CONTRACT_TEST_FULL === 'true',
    baseSha: process.env.CONTRACT_TEST_BASE_SHA,
    headSha: process.env.CONTRACT_TEST_HEAD_SHA,
    onFallback: (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Failed to resolve changed files; falling back to the full test matrix: ${reason}`);
    },
  });

  if (process.env.GITHUB_OUTPUT) writeOutputs(result.plan, process.env.GITHUB_OUTPUT);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
