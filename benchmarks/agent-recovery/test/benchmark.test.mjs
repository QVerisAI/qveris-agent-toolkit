import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runFixtureBenchmark, summarize, validateFixtureSet } from '../src/run.mjs';

test('fixture benchmark covers every required recovery class without production claims', async () => {
  const result = await runFixtureBenchmark();
  assert.equal(result.lane, 'deterministic_fixture');
  assert.equal(result.production_success_claim, false);
  assert.deepEqual(
    result.records.map((record) => record.id),
    [
      'ordinary_success',
      'service_only',
      'expired_context',
      'unknown_extension',
      'incomplete_schema',
      'missing_quote',
      'permission_denied',
      'insufficient_balance',
      'upstream_failure',
      'unknown_settlement',
      'provider_fallback',
    ],
  );
  assert.deepEqual(result.summary, summarize(result.records));
  assert.equal(result.schema_version, 2);
  assert.equal(result.summary.expected_outcome_rate, 1);
  assert.equal(result.summary.completion.eligible_cases, 6);
  assert.equal(result.summary.completion.eligible_task_completion_rate, 5 / 6);
  assert.equal(result.summary.completion.autonomous_eligible_cases, 5);
  assert.equal(result.summary.completion.autonomous_task_completion_rate, 1);
  assert.equal(result.summary.completion.first_attempt_autonomous_completion_rate, 2 / 5);
  assert.equal(result.summary.completion.all_fixture_completion_rate, 5 / 11);
  assert.deepEqual(result.summary.recovery, {
    cases: 4,
    attempted_rate: 1,
    expected_outcome_rate: 1,
    task_completion_rate: 3 / 4,
    unresolved_rate: 1 / 4,
    failed_rate: 0,
  });
  assert.deepEqual(result.summary.intervention, {
    expected_cases: 4,
    observed_cases: 4,
    correct_action_rate: 1,
    unexpected_action_rate: 0,
    expected_by_reason: { tool_selection: 1, quote: 1, permission: 1, credits: 1 },
  });
  assert.deepEqual(result.summary.safety, {
    autonomous_false_rejection_rate: 0,
    unexpected_contract_rejection_rate: 0,
    non_autonomous_outcome_accuracy: 1,
    submitted_calls: 8,
    replayed_submitted_calls: 0,
  });
  assert.equal(result.summary.fallback.success_rate, 1);
  assert.equal(result.summary.pricing.continuation_rate, 1);
  assert.ok(result.records.every((record) => record.expected_outcome_observed));
  assert.equal(result.records.find((record) => record.id === 'unknown_settlement').observed_intervention, 'none');
  assert.equal(process.exitCode, undefined);
});

test('fixture schema rejects ambiguous metric eligibility', () => {
  assert.throws(
    () =>
      validateFixtureSet({
        schema_version: 2,
        cases: [
          {
            id: 'ambiguous',
            scenario: 'ordinary',
            expected_outcome: 'success',
            completion_eligible: false,
            autonomous_completion_eligible: true,
            recovery_expected: false,
            expected_intervention: 'permission',
          },
        ],
      }),
    /cannot be autonomous/,
  );
});

for (const baseline of ['before', 'after']) {
  test(`${baseline} baseline uses schema-v2 metrics and matches its records`, async () => {
    const path = new URL(`../results/${baseline}.json`, import.meta.url);
    const result = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(result.schema_version, 2);
    assert.equal(result.fixture_source, 'fixtures/v2.json');
    assert.equal(result.records.length, 11);
    assert.deepEqual(result.summary, summarize(result.records));
  });
}
