import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixtureBenchmark, summarize } from '../src/run.mjs';

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
  assert.equal(result.summary.task_completion_rate, 5 / 11);
  assert.equal(result.summary.automatic_recovery.success_rate, 3 / 4);
  assert.equal(result.summary.usable_tool_false_rejection_rate, 0);
  assert.equal(result.summary.provider_tool_fallback_success_rate, 1);
  assert.ok(result.records.every((record) => record.expected_outcome_observed));
  assert.equal(process.exitCode, undefined);
});
