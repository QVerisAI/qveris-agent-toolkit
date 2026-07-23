import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizePublicRecords, validatePublicRecords } from '../src/publication.mjs';

const policy = {
  schema_version: 1,
  policy_id: 'test-public-v1',
  catalog_visibility_default: 'private',
  publish_parameters: true,
  legacy_lane_rewrites: { 'pinned-model': 'configured-model' },
  approved_selected_tool_ids: ['weather.tool'],
  forbidden_fields: [
    'execution_id',
    'search_id',
    'connection_id',
    'remaining_credits',
    'result_tool_ids',
    'returned_tool_ids',
  ],
};

test('publishes grounded attestations and hashes instead of operational identifiers or catalog rows', () => {
  const [record] = sanitizePublicRecords(
    [
      {
        schema_version: 1,
        benchmark_version: 'v4',
        run_id: 'run-1',
        model: 'model-a',
        metadata: { lane: 'configured-model', api_revision: '2026-07-22.1' },
        task_id: 'weather',
        trial: 1,
        status: 'completed',
        discovery: {
          search_id: 'search-1',
          result_tool_ids: ['other.tool', 'weather.tool'],
        },
        selection: { tool_id: 'weather.tool' },
        inspection: { returned_tool_ids: ['weather.tool'], required_parameters: ['city'] },
        parameters: { city: 'Shanghai' },
        call: {
          attempted: true,
          success: true,
          execution_id: 'execution-1',
          result_nonempty: true,
        },
      },
    ],
    policy,
  );

  assert.equal(record.discovery.result_count, 2);
  assert.equal(record.discovery.snapshot_sha256.length, 64);
  assert.equal(record.discovery.selection_grounded, true);
  assert.equal(record.inspection.selection_grounded, true);
  assert.equal(record.call.result_nonempty, true);
  assert.equal(record.metadata.publication_policy, policy.policy_id);
  assert.equal(record.metadata.model_revision, 'unreported');
  assert.equal(record.metadata.catalog_revision, 'unreported');
  assert.equal(record.source_record_sha256.length, 64);
  for (const forbidden of policy.forbidden_fields) {
    assert.equal(JSON.stringify(record).includes(`"${forbidden}"`), false);
  }
  assert.doesNotThrow(() => validatePublicRecords([record], policy));
});

test('refuses to publish an unapproved selected tool', () => {
  assert.throws(
    () =>
      sanitizePublicRecords(
        [
          {
            selection: { tool_id: 'private.tool' },
            discovery: { result_tool_ids: ['private.tool'] },
          },
        ],
        policy,
      ),
    /not approved/,
  );
});
