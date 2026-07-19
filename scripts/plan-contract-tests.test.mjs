import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyContractChanges } from './plan-contract-tests.mjs';

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
