import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sanitizePublicRecords,
  validatePolicy,
  validatePublicRecords,
} from '../src/publication.mjs';

const policy = {
  schema_version: 1,
  policy_id: 'test-public-v1',
  catalog_visibility_default: 'private',
  publish_parameters: true,
  unapproved_selected_tool_handling: 'hash',
  legacy_lane_rewrites: { 'pinned-model': 'configured-model' },
  approved_selected_tool_ids: ['weather.tool'],
  forbidden_fields: [
    'execution_id',
    'search_id',
    'connection_id',
    'remaining_credits',
    'result_tool_ids',
    'returned_tool_ids',
    'api_key',
    'access_token',
    'refresh_token',
    'oauth_token',
    'authorization',
    'client_secret',
    'password',
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
        metadata: {
          lane: 'configured-model',
          api_revision: '2026-07-22.1',
          internal_note: 'must-not-publish',
        },
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
  assert.equal('internal_note' in record.metadata, false);
  assert.equal(record.source_record_sha256.length, 64);
  for (const forbidden of policy.forbidden_fields) {
    assert.equal(JSON.stringify(record).includes(`"${forbidden}"`), false);
  }
  assert.doesNotThrow(() => validatePublicRecords([record], policy));
});

test('hashes an unapproved selected tool instead of expanding the public catalog', () => {
  const [record] = sanitizePublicRecords(
    [
      {
        selection: { tool_id: 'private.tool' },
        discovery: { result_tool_ids: ['private.tool'] },
      },
    ],
    policy,
  );
  assert.equal(record.selection.tool_id, null);
  assert.equal(record.selection.tool_id_sha256.length, 64);
  assert.equal(record.discovery.selection_grounded, true);
});

test('projects safe error fields and rejects credential-shaped parameter keys', () => {
  const [record] = sanitizePublicRecords(
    [
      {
        selection: { tool_id: null },
        error: {
          stage: 'adapter',
          reason_code: 'tool_use_rejected',
          message: 'raw provider body with a secret',
          provider_response: 'private',
        },
      },
    ],
    policy,
  );
  assert.deepEqual(record.error, {
    stage: 'adapter',
    reason_code: 'tool_use_rejected',
  });
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            metadata: { ...record.metadata, internal_note: 'must-not-publish' },
          },
        ],
        policy,
      ),
    /unsupported metadata/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            error: { ...record.error, message: 'raw provider body' },
          },
        ],
        policy,
      ),
    /unsupported fields/,
  );

  assert.throws(
    () =>
      sanitizePublicRecords(
        [
          {
            selection: { tool_id: null },
            parameters: { apiKey: 'must-not-publish' },
          },
        ],
        policy,
      ),
    /Forbidden public artifact field/,
  );
});

test('publication policy cannot omit a required protected field', () => {
  assert.throws(
    () =>
      validatePolicy({
        ...policy,
        forbidden_fields: policy.forbidden_fields.filter((field) => field !== 'api_key'),
      }),
    /must forbid protected fields: api_key/,
  );
});
