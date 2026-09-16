import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateOperationalMetrics, summarizeOperationalTasks,
  validateAlertConfig, evaluateAlerts,
} from '../src/metrics.mjs';
import { runFixtureBenchmark } from '../src/run.mjs';

const dataset = JSON.parse(await readFile(new URL('../fixtures/operational-events.v1.json', import.meta.url)));
const config = JSON.parse(await readFile(new URL('../config/alerts.v1.json', import.meta.url)));
const baseline = evaluateOperationalMetrics(dataset, config);
const clone = () => structuredClone(dataset);

test('supported fallback and consumer-upgrade actions are accepted', () => {
  for (const action of ['select_fallback', 'upgrade_consumer']) {
    const input = clone();
    input.tasks[0].calls[0].next_action = action;
    assert.doesNotThrow(() => evaluateOperationalMetrics(input, config));
  }
});

test('controlled task counts and completion/recovery declarations agree with the running CLI', async () => {
  const actual = await runFixtureBenchmark();
  assert.equal(actual.records.length, dataset.tasks.length);
  for (const task of dataset.tasks) {
    const record = actual.records.find((item) => item.id === task.task_id);
    assert.ok(record, task.task_id);
    assert.equal(task.completed, record.completed, task.task_id);
    assert.equal(task.completion_eligible, record.completion_eligible, task.task_id);
    assert.equal(task.calls.length, record.execute_calls, task.task_id);
    assert.equal(task.automatic_recovery.attempted, record.recovery_attempts > 0, task.task_id);
    if (task.calls.length) assert.equal(task.calls.at(-1).next_action, record.next_action.action, task.task_id);
  }
});

test('task order and identical repeated settlement rows do not change metrics', () => {
  const input = clone();
  input.tasks.reverse();
  for (const task of input.tasks) {
    for (const call of task.calls) {
      call.settlements.push(...structuredClone(call.settlements));
      call.settlements.reverse();
    }
  }
  assert.deepEqual(evaluateOperationalMetrics(input, config).metrics, baseline.metrics);
});

test('task-wide duplicates stay one charge; conflicts fail regardless of call order', () => {
  for (const field of ['amount_credits', 'charge_outcome']) {
    const input = clone();
    const task = input.tasks[0];
    const second = structuredClone(task.calls[0]);
    second.call_id = 'second-attempt';
    task.calls.push(second);
    const valid = evaluateOperationalMetrics(input, config);
    assert.equal(valid.metrics.duplicate_charge_task_rate.numerator, 0);
    assert.equal(valid.metrics.duplicate_call_task_rate.numerator, 1);
    second.settlements[0][field] = field === 'amount_credits' ? 99 : 'failed_charged_review';
    for (let order = 0; order < 2; order += 1) {
      task.calls.reverse();
      assert.throws(() => evaluateOperationalMetrics(input, config), /conflicting observations/);
    }
  }
});

test('IDs cannot double-count the same evidence across tasks', () => {
  for (const field of ['call_id', 'settlement_id']) {
    const input = clone();
    const first = input.tasks[0].calls[0];
    const other = input.tasks[2].calls[0];
    if (field === 'call_id') other.call_id = first.call_id;
    else other.settlements[0].settlement_id = first.settlements[0].settlement_id;
    assert.throws(() => evaluateOperationalMetrics(input, config), /duplicate call_id|multiple tasks/);
  }
});

test('invalid amounts and inconsistent no-charge outcomes fail before scoring', () => {
  for (const amount of [NaN, Infinity, -Infinity, -1, '1', null]) {
    const input = clone();
    input.tasks[0].calls[0].settlements[0].amount_credits = amount;
    assert.throws(() => summarizeOperationalTasks(input.tasks), /non-negative amount/);
  }
  for (const outcome of ['pending', 'included', 'failed_not_charged']) {
    const input = clone();
    input.tasks[0].calls[0].settlements[0].charge_outcome = outcome;
    assert.throws(() => evaluateOperationalMetrics(input, config), /inconsistent/);
  }
});

test('rejected calls reject both zero-amount charged outcomes and positive amounts', () => {
  for (const [outcome, amount] of [['charged', 0], ['failed_charged_review', 0], ['pending', 1]]) {
    const input = clone();
    const call = input.tasks.find((task) => task.task_id === 'insufficient_balance').calls[0];
    call.settlements = [{ settlement_id: 'contradiction', charge_outcome: outcome, amount_credits: amount }];
    assert.throws(() => evaluateOperationalMetrics(input, config), /charge-bearing/);
  }
});

test('a settled attempt cannot hide another attempt with pending settlement', () => {
  const input = clone();
  input.tasks[0].calls.push({
    call_id: 'pending-second', execution_id: 'exec-second', submission_outcome: 'unknown',
    next_action: 'wait_and_reconcile', settlements: [],
  });
  const result = evaluateOperationalMetrics(input, config);
  assert.equal(result.metrics.final_settlement_evidence_coverage.numerator, 5);
  assert.equal(result.metrics.final_settlement_evidence_coverage.denominator, 7);
  assert.equal(result.metrics.duplicate_call_task_rate.status, 'breached');
});

test('safety configuration cannot suppress an incident and rates cannot be forged', () => {
  for (const name of ['duplicate_call_task_rate', 'duplicate_charge_task_rate', 'missing_execution_id_rate']) {
    for (const [field, value] of [['threshold', 0.1], ['min_denominator', 100], ['severity', 'warning'], ['direction', 'min']]) {
      const policy = structuredClone(config);
      policy.metrics[name][field] = value;
      assert.throws(() => validateAlertConfig(policy), /safety policy|direction/);
    }
  }
  for (const value of [NaN, Infinity, -1, 2]) {
    const policy = structuredClone(config);
    policy.metrics.task_completion_rate.threshold = value;
    assert.throws(() => validateAlertConfig(policy), /threshold/);
  }
  const typo = structuredClone(config);
  typo.metrics.task_completin_rate = typo.metrics.task_completion_rate;
  assert.throws(() => validateAlertConfig(typo), /Unknown alert metric/);
  const injected = structuredClone(config);
  injected.metrics.task_completion_rate.rate = 1;
  assert.throws(() => validateAlertConfig(injected), /Unknown alert rule field/);
  const metrics = summarizeOperationalTasks(dataset.tasks);
  metrics.task_completion_rate.rate = NaN;
  assert.throws(() => evaluateAlerts(metrics, config), /Invalid metric/);
});

test('no settlement observations is insufficient evidence, not a green summary', () => {
  const input = clone();
  input.tasks = [input.tasks.find((task) => task.task_id === 'service_only')];
  assert.equal(evaluateOperationalMetrics(input, config).alert_summary.status, 'insufficient_data');
});

test('unknown flags, duplicate options, and missing paths fail instead of scoring default fixtures', () => {
  const script = fileURLToPath(new URL('../src/metrics.mjs', import.meta.url));
  for (const args of [['--inpt', '/tmp/export.json'], ['--input'], ['--fail-on-alert', '--fail-on-alert']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Unknown or duplicate option|requires a value/);
  }
});
