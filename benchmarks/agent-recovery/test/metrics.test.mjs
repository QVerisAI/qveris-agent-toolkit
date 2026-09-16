import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateAlerts,
  evaluateOperationalMetrics,
  summarizeOperationalTasks,
  validateOperationalDataset,
} from '../src/metrics.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
}

test('controlled operational baseline defines stable numerators and denominators', async () => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const alerts = await fixture('config/alerts.v1.json');
  const result = evaluateOperationalMetrics(dataset, alerts);

  assert.equal(result.production_success_claim, false);
  assert.equal(result.task_count, 11);
  assert.deepEqual(result.metrics.task_completion_rate, {
    numerator: 5,
    denominator: 6,
    rate: 5 / 6,
    description:
      'Completed tasks / tasks explicitly eligible to complete under the supplied authority and fixture state.',
    direction: 'min',
    threshold: 0.8,
    min_denominator: 5,
    severity: 'warning',
    status: 'pass',
  });
  assert.deepEqual(result.metrics.automatic_recovery_success_rate, {
    numerator: 3,
    denominator: 4,
    rate: 3 / 4,
    description: 'Tasks completed by automatic recovery / tasks where automatic recovery was attempted.',
    direction: 'min',
    threshold: 0.75,
    min_denominator: 4,
    severity: 'warning',
    status: 'pass',
  });
  assert.deepEqual(result.metrics.duplicate_call_task_rate, {
    numerator: 0,
    denominator: 8,
    rate: 0,
    excess_submitted_calls: 0,
    description: 'Tasks with more than one submitted Call request / tasks with at least one submitted Call request.',
    direction: 'max',
    threshold: 0,
    min_denominator: 1,
    severity: 'critical',
    status: 'pass',
  });
  assert.equal(result.metrics.duplicate_charge_task_rate.numerator, 0);
  assert.equal(result.metrics.duplicate_charge_task_rate.denominator, 4);
  assert.equal(result.metrics.duplicate_charge_task_rate.excess_charge_settlements, 0);
  assert.deepEqual(
    [
      result.metrics.review_settlement_rate.numerator,
      result.metrics.review_settlement_rate.denominator,
      result.metrics.review_settlement_rate.rate,
    ],
    [0, 2, 0],
  );
  assert.deepEqual(
    [
      result.metrics.missing_execution_id_rate.numerator,
      result.metrics.missing_execution_id_rate.denominator,
      result.metrics.missing_execution_id_rate.rate,
    ],
    [0, 7, 0],
  );
  assert.deepEqual(
    [
      result.metrics.final_settlement_evidence_coverage.numerator,
      result.metrics.final_settlement_evidence_coverage.denominator,
      result.metrics.final_settlement_evidence_coverage.rate,
    ],
    [6, 7, 6 / 7],
  );
  assert.deepEqual(result.alert_summary, { status: 'pass', alert_count: 0, alerts: [] });
});

test('zero-tolerance safety regressions and settlement toil breach guardrails', async () => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const alerts = await fixture('config/alerts.v1.json');
  const incident = structuredClone(dataset);
  const upstream = incident.tasks.find((task) => task.task_id === 'upstream_failure');
  upstream.calls[0].execution_id = null;
  upstream.calls[0].next_action = 'review_settlement';
  const ordinary = incident.tasks.find((task) => task.task_id === 'ordinary_success');
  ordinary.calls.push({
    call_id: 'call-ordinary-replay',
    submission_outcome: 'success',
    execution_id: 'exec-ordinary-replay',
    next_action: 'none',
    settlements: [
      {
        settlement_id: 'settlement-ordinary-replay',
        charge_outcome: 'charged',
        amount_credits: 1,
      },
    ],
  });

  const result = evaluateOperationalMetrics(incident, alerts);
  assert.equal(result.metrics.duplicate_call_task_rate.numerator, 1);
  assert.equal(result.metrics.duplicate_call_task_rate.excess_submitted_calls, 1);
  assert.equal(result.metrics.duplicate_charge_task_rate.numerator, 1);
  assert.equal(result.metrics.duplicate_charge_task_rate.excess_charge_settlements, 1);
  assert.equal(result.metrics.review_settlement_rate.rate, 1 / 2);
  assert.equal(result.metrics.missing_execution_id_rate.rate, 1 / 8);
  assert.deepEqual(
    result.alert_summary.alerts.map((alert) => alert.metric).sort(),
    [
      'duplicate_call_task_rate',
      'duplicate_charge_task_rate',
      'missing_execution_id_rate',
      'review_settlement_rate',
    ],
  );
  assert.ok(
    result.alert_summary.alerts
      .filter((alert) => alert.metric !== 'review_settlement_rate')
      .every((alert) => alert.severity === 'critical'),
  );
});

test('identical repeated settlement observations are deduplicated before scoring', async () => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const alerts = await fixture('config/alerts.v1.json');
  const repeated = structuredClone(dataset);
  const settlements = repeated.tasks.find((task) => task.task_id === 'ordinary_success').calls[0].settlements;
  settlements.push(structuredClone(settlements[0]));

  const result = evaluateOperationalMetrics(repeated, alerts);
  assert.equal(result.metrics.duplicate_charge_task_rate.numerator, 0);
  assert.equal(result.metrics.duplicate_charge_task_rate.denominator, 4);
  assert.equal(result.metrics.final_settlement_evidence_coverage.rate, 6 / 7);
});

test('conflicting or unsupported settlement observations are rejected before scoring', async () => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const conflicting = structuredClone(dataset);
  const settlements = conflicting.tasks.find((task) => task.task_id === 'ordinary_success').calls[0].settlements;
  settlements.push({ ...settlements[0], amount_credits: 2 });
  assert.throws(() => validateOperationalDataset(conflicting), /conflicting observations/);

  const unsupported = structuredClone(dataset);
  unsupported.tasks.find((task) => task.task_id === 'ordinary_success').calls[0].settlements[0].charge_outcome = 'settled';
  assert.throws(() => validateOperationalDataset(unsupported), /unsupported charge_outcome/);
});

test('rejected calls cannot hide charge evidence and unknown actions cannot hide settlement recovery', async () => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const chargedRejected = structuredClone(dataset);
  const rejectedCall = chargedRejected.tasks.find((task) => task.task_id === 'insufficient_balance').calls[0];
  rejectedCall.settlements.push({
    settlement_id: 'settlement-rejected-charge',
    charge_outcome: 'charged',
    amount_credits: 1,
  });
  assert.throws(() => validateOperationalDataset(chargedRejected), /cannot include a charge-bearing settlement/);

  const unknownAction = structuredClone(dataset);
  unknownAction.tasks.find((task) => task.task_id === 'upstream_failure').calls[0].next_action = 'review-settlemnt';
  assert.throws(() => validateOperationalDataset(unknownAction), /unsupported next_action/);
});

test('fail-on-alert exits nonzero and emits GitHub annotations', async (t) => {
  const dataset = await fixture('fixtures/operational-events.v1.json');
  const incident = structuredClone(dataset);
  incident.tasks.find((task) => task.task_id === 'upstream_failure').calls[0].execution_id = null;
  const directory = await mkdtemp(join(tmpdir(), 'qveris-recovery-alert-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'incident.json');
  await writeFile(inputPath, JSON.stringify(incident), 'utf8');

  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../src/metrics.mjs', import.meta.url)), '--input', inputPath, '--fail-on-alert'],
    {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'true' },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error title=Recovery metric missing_execution_id_rate::/);
  assert.equal(JSON.parse(result.stdout).alert_summary.status, 'alerting');
});

test('low-volume rates stay insufficient instead of paging on an empty denominator', async () => {
  const alerts = await fixture('config/alerts.v1.json');
  const metrics = summarizeOperationalTasks([
    {
      task_id: 'no-call',
      completion_eligible: true,
      completed: true,
      automatic_recovery: { attempted: false, succeeded: false },
      calls: [],
    },
  ]);
  const result = evaluateAlerts(metrics, alerts);
  assert.equal(result.evaluations.duplicate_call_task_rate.status, 'insufficient_data');
  assert.equal(result.evaluations.duplicate_charge_task_rate.status, 'insufficient_data');
  assert.equal(result.evaluations.missing_execution_id_rate.status, 'insufficient_data');
  assert.deepEqual(result.alerts, []);
});

test('operational schema rejects ambiguous safety evidence', () => {
  assert.throws(
    () =>
      validateOperationalDataset({
        schema_version: 1,
        production_data: false,
        tasks: [
          {
            task_id: 'bad-recovery',
            completion_eligible: true,
            completed: false,
            automatic_recovery: { attempted: false, succeeded: true },
            calls: [],
          },
        ],
      }),
    /cannot succeed automatic recovery without an attempt/,
  );
});

test('checked-in operational baseline matches the controlled inputs', async () => {
  const datasetText = await readFile(new URL('../fixtures/operational-events.v1.json', import.meta.url), 'utf8');
  const alertsText = await readFile(new URL('../config/alerts.v1.json', import.meta.url), 'utf8');
  const frozen = await fixture('results/operational-baseline.v1.json');
  const result = evaluateOperationalMetrics(JSON.parse(datasetText), JSON.parse(alertsText), {
    events_sha256: createHash('sha256').update(datasetText).digest('hex'),
    alerts_sha256: createHash('sha256').update(alertsText).digest('hex'),
  });
  assert.deepEqual(frozen, result);
});
