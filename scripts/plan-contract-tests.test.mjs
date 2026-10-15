import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, globSync } from 'node:fs';

import { classifyContractChanges, resolveContractPlan } from './plan-contract-tests.mjs';

test('PR workflow executes the shared contract guards through the root script suite', () => {
  const workflow = readFileSync(new URL('../.github/workflows/contract-tests.yml', import.meta.url), 'utf8');
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(workflow, /run: npm run test:scripts/);
  assert.match(root.scripts['test:scripts'], /scripts\/\*\.test\.mjs/);
});
test('a CLI-only change does not schedule unrelated SDKs', () => {
  assert.deepEqual(classifyContractChanges(['packages/cli/src/main.mjs']), {
    benchmark: false,
    cli: true,
    python: false,
    js: false,
    mcp: false,
    plugin: false,
    lint: true,
    lint_cli: true,
    lint_python: false,
    lint_js: false,
    lint_mcp: false,
    lint_plugin: false,
    examples: true,
    os_matrix: ['ubuntu-latest'],
  });
});

test('the public OpenAPI contract schedules every contract consumer', () => {
  const plan = classifyContractChanges(['docs/openapi/qveris-public-api.openapi.json']);

  assert.equal(plan.cli, true);
  assert.equal(plan.python, true);
  assert.equal(plan.js, true);
  assert.equal(plan.mcp, true);
  assert.equal(plan.plugin, false);
  assert.equal(plan.benchmark, false);
});

test('delivery profiles and either handwritten TS surface run the wire compatibility guard', () => {
  for (const file of [
    'contracts/result-delivery.v1.json',
    'scripts/result-delivery-contract.test.mjs',
    'scripts/public-capability-contract.test.mjs',
    'packages/mcp/src/types.ts',
    'packages/js-sdk/src/types.ts',
  ]) {
    assert.equal(classifyContractChanges([file]).js, true, file);
  }
});

test('shared lint configuration schedules lint without expensive test suites', () => {
  const plan = classifyContractChanges(['.prettierrc.json']);

  assert.deepEqual(plan, {
    benchmark: false,
    cli: false,
    python: false,
    js: false,
    mcp: false,
    plugin: false,
    lint: true,
    lint_cli: true,
    lint_python: true,
    lint_js: true,
    lint_mcp: true,
    lint_plugin: true,
    examples: false,
    os_matrix: ['ubuntu-latest'],
  });
});

test('workflow changes and full runs exercise every target and both operating systems', () => {
  const workflowPlan = classifyContractChanges(['.github/workflows/contract-tests.yml']);
  const fullPlan = classifyContractChanges([], { full: true });

  for (const target of ['benchmark', 'cli', 'python', 'js', 'mcp', 'plugin']) {
    assert.equal(workflowPlan[target], true);
    assert.equal(fullPlan[target], true);
  }
  assert.deepEqual(workflowPlan.os_matrix, ['ubuntu-latest']);
  assert.deepEqual(fullPlan.os_matrix, ['ubuntu-latest', 'windows-latest']);
  assert.equal(fullPlan.lint, true);
  assert.equal(fullPlan.lint_cli, true);
  assert.equal(fullPlan.lint_python, true);
  assert.equal(fullPlan.lint_js, true);
  assert.equal(fullPlan.lint_mcp, true);
  assert.equal(fullPlan.lint_plugin, true);
  assert.equal(fullPlan.examples, true);
});

test('root task-runner configuration and lockfile schedule every package on the PR platform', () => {
  for (const file of ['package.json', 'package-lock.json']) {
    const plan = classifyContractChanges([file]);

    for (const target of ['benchmark', 'cli', 'python', 'js', 'mcp', 'plugin']) {
      assert.equal(plan[target], true);
    }
    assert.deepEqual(plan.os_matrix, ['ubuntu-latest']);
  }
});

test('missing git history fails safe to the full cross-platform matrix', () => {
  let fallbackReason = '';
  const result = resolveContractPlan({
    baseSha: 'missing-base',
    headSha: 'missing-head',
    diff: () => {
      throw new Error('base commit is unavailable');
    },
    onFallback: (error) => {
      fallbackReason = error.message;
    },
  });

  assert.equal(result.full, true);
  assert.deepEqual(result.files, []);
  assert.equal(fallbackReason, 'base commit is unavailable');
  for (const target of ['benchmark', 'cli', 'python', 'js', 'mcp', 'plugin']) {
    assert.equal(result.plan[target], true);
  }
  assert.deepEqual(result.plan.os_matrix, ['ubuntu-latest', 'windows-latest']);
});

test('duplicate and empty filenames do not create false-positive targets', () => {
  assert.deepEqual(classifyContractChanges(['', 'README.md', 'README.md']), {
    benchmark: false,
    cli: false,
    python: false,
    js: false,
    mcp: false,
    plugin: false,
    lint: false,
    lint_cli: false,
    lint_python: false,
    lint_js: false,
    lint_mcp: false,
    lint_plugin: false,
    examples: false,
    os_matrix: ['ubuntu-latest'],
  });
});

test('package configuration changes trigger the workflow and select their consumers', () => {
  const workflow = readFileSync(new URL('../.github/workflows/contract-tests.yml', import.meta.url), 'utf8');
  const patterns = [...workflow.split('  schedule:')[0].matchAll(/- "([^"\n]+)"/g)].map((match) => match[1]);
  const covered = new Set(patterns.flatMap((pattern) => globSync(pattern)));
  for (const [file, target] of [
    ['packages/js-sdk/tsconfig.json', 'js'],
    ['packages/js-sdk/vitest.config.ts', 'js'],
    ['packages/mcp/vitest.config.ts', 'mcp'],
    ['packages/openclaw-qveris-plugin/vitest.config.ts', 'plugin'],
  ]) {
    assert.ok(covered.has(file), `${file} must trigger contract tests`);
    assert.equal(classifyContractChanges([file])[target], true);
  }
  for (const file of globSync('scripts/*.test.mjs')) {
    assert.ok(covered.has(file), `${file} must trigger repository script tests`);
  }
  assert.match(workflow, /run: npm run test:scripts/);
});

test('the planner has no self dependency and plugin lint uses its required runtime', () => {
  const workflow = readFileSync(new URL('../.github/workflows/contract-tests.yml', import.meta.url), 'utf8');
  const planJob = workflow.split('  plan:')[1].split('\n  discover-call-benchmark:')[0];
  assert.doesNotMatch(planJob, /needs\.plan/);
  const lintJob = workflow.split('\n  lint:')[1].split('\n  examples:')[0];
  assert.match(lintJob, /node-version:.*needs\.plan\.outputs\.lint_plugin.*24\.16\.0/);
});


test('AI guide examples and their compiler select the packed JS compatibility matrix', () => {
  for (const file of [
    'scripts/verify-ai-compatibility.mjs',
    'docs/en-US/js-sdk.md',
    'docs/zh-CN/js-sdk.md',
    'docs/cn/zh-CN/js-sdk.md',
  ]) {
    const plan = classifyContractChanges([file]);
    assert.equal(plan.js, true, file);
    assert.equal(plan.lint_js, true, file);
    for (const target of ['benchmark', 'cli', 'python', 'mcp', 'plugin']) {
      assert.equal(plan[target], false, `${file} must not select ${target}`);
    }
  }
});
