import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sanitizePublicRecords,
  validateOfficialPublicRun,
  validatePolicy,
  validatePublicRecords,
} from '../src/publication.mjs';

const taskSetSha256 = 'a'.repeat(64);
const task = {
  id: 'weather',
  prompt: 'Weather in Shanghai',
  constraints: [{ id: 'city', aliases: ['city'], value: 'Shanghai' }],
};
const tasks = [task];
const policy = {
  schema_version: 1,
  policy_id: 'test-public-v1',
  catalog_visibility_default: 'private',
  publish_parameters: false,
  unapproved_selected_tool_handling: 'hash',
  legacy_lane_rewrites: { 'pinned-model': 'configured-model' },
  approved_api_base_urls: ['https://qveris.ai/api/v1'],
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
    'parameters',
    'required_parameters',
  ],
};

test('publishes score attestations and hashes instead of raw parameters or catalog rows', () => {
  const [record] = sanitizePublicRecords(
    [
      rawRecord({
        metadata: {
          lane: 'configured-model',
          api_revision: '2026-07-22.1',
          task_set_sha256: taskSetSha256,
          api_base_url: 'https://qveris.ai/api/v1',
          discovery_limit: 10,
          execute: true,
          internal_note: 'must-not-publish',
        },
        discovery: {
          search_id: 'search-1',
          result_tool_ids: ['other.tool', 'weather.tool'],
        },
        call: {
          attempted: true,
          success: true,
          execution_id: 'execution-1',
          result_nonempty: true,
        },
      }),
    ],
    policy,
    tasks,
  );

  assert.equal(record.discovery.result_count, 2);
  assert.equal(record.discovery.snapshot_sha256.length, 64);
  assert.equal(record.discovery.selection_grounded, true);
  assert.equal(record.inspection.selection_grounded, true);
  assert.equal(record.call.result_nonempty, true);
  assert.deepEqual(record.parameterization, {
    required_parameter_accuracy: 1,
    constraint_accuracy: 1,
  });
  assert.equal(JSON.stringify(record).includes('Shanghai'), false);
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
      rawRecord({
        discovery: { result_tool_ids: ['private.tool'] },
        selection: { tool_id: 'private.tool' },
        inspection: { returned_tool_ids: ['private.tool'], required_parameters: [] },
        parameters: {},
      }),
    ],
    policy,
    tasks,
  );
  assert.equal(record.selection.tool_id, null);
  assert.equal(record.selection.tool_id_sha256.length, 64);
  assert.equal(record.discovery.selection_grounded, true);
});

test('recomputes parameterization scores instead of trusting raw attestations', () => {
  const [record] = sanitizePublicRecords(
    [
      rawRecord({
        parameters: { city: 'Wrong city' },
        parameterization: {
          required_parameter_accuracy: 1,
          constraint_accuracy: 1,
        },
      }),
    ],
    policy,
    tasks,
  );
  assert.deepEqual(record.parameterization, {
    required_parameter_accuracy: 1,
    constraint_accuracy: 0,
  });
});

test('recomputes and verifies the catalog observation digest', () => {
  const record = rawRecord();
  const [published] = sanitizePublicRecords([record], policy, tasks);
  assert.equal(published.metadata.catalog_observation_sha256.length, 64);
  assert.notEqual(published.metadata.catalog_observation_sha256, 'b'.repeat(64));
  assert.throws(
    () =>
      sanitizePublicRecords(
        [
          rawRecord({
            metadata: {
              ...record.metadata,
              catalog_observation_sha256: 'b'.repeat(64),
            },
          }),
        ],
        policy,
        tasks,
      ),
    /catalog observation digest does not match/,
  );
});

test('projects safe errors and rejects unsupported public fields at every boundary', () => {
  const [record] = sanitizePublicRecords(
    [
      rawRecord({
        status: 'failed',
        selection: { tool_id: null },
        inspection: { returned_tool_ids: [], required_parameters: [] },
        parameters: { query: 'private customer prompt' },
        call: { attempted: false, success: null },
        error: {
          stage: 'adapter',
          reason_code: 'tool_use_rejected',
          message: 'raw provider body with a secret',
          provider_response: 'private',
        },
      }),
    ],
    policy,
    tasks,
  );
  assert.deepEqual(record.error, {
    stage: 'adapter',
    reason_code: 'tool_use_rejected',
  });
  assert.equal(JSON.stringify(record).includes('private customer prompt'), false);
  assert.throws(
    () => validatePublicRecords([{ ...record, provider_response: 'private' }], policy),
    /unsupported field at \$\.provider_response/,
  );
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
    /unsupported field at \$\.metadata\.internal_note/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            call: { ...record.call, provider_response: 'private' },
          },
        ],
        policy,
      ),
    /unsupported field at \$\.call\.provider_response/,
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
    /unsupported field at \$\.error\.message/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            call: { ...record.call, success: 'raw provider value' },
          },
        ],
        policy,
      ),
    /call fields have invalid types/,
  );
});

test('rejects contradictory public lifecycle attestations', () => {
  const [record] = sanitizePublicRecords([rawRecord()], policy, tasks);
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            finished_at: '2026-07-22T23:59:59.000Z',
          },
        ],
        policy,
      ),
    /inconsistent lifecycle fields/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            status: 'failed',
          },
        ],
        policy,
      ),
    /inconsistent lifecycle fields/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            call: { attempted: false, success: true, result_nonempty: true },
          },
        ],
        policy,
      ),
    /inconsistent call lifecycle/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            call: { attempted: true, success: null },
          },
        ],
        policy,
      ),
    /inconsistent call lifecycle/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            status: 'failed',
            error: { stage: 'api', reason_code: 'request_failed' },
            call: { attempted: true, success: true, result_nonempty: true },
          },
        ],
        policy,
      ),
    /inconsistent call lifecycle/,
  );
});

test('rejects unsafe metadata scalar types and control characters', () => {
  const [record] = sanitizePublicRecords([rawRecord()], policy, tasks);
  assert.throws(
    () =>
      sanitizePublicRecords(
        [
          rawRecord({
            metadata: {
              ...rawRecord().metadata,
              runtime: { node: { private: 'nested value' }, platform: 'darwin', arch: 'arm64' },
            },
          }),
        ],
        policy,
        tasks,
      ),
    /invalid public metadata values/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            metadata: {
              ...record.metadata,
              runtime: { ...record.metadata.runtime, node: { private: 'nested value' } },
            },
          },
        ],
        policy,
      ),
    /invalid public metadata values/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            metadata: { ...record.metadata, api_revision: 'revision\nprivate-value' },
          },
        ],
        policy,
      ),
    /invalid public metadata values/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            metadata: { ...record.metadata, api_revision: 'safe\u202Etxt' },
          },
        ],
        policy,
      ),
    /invalid public metadata values/,
  );
});

test('rejects impossible public grounding attestations', () => {
  const [record] = sanitizePublicRecords([rawRecord()], policy, tasks);
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            discovery: { ...record.discovery, result_count: 0 },
          },
        ],
        policy,
      ),
    /inconsistent grounding attestations/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            discovery: { ...record.discovery, selection_grounded: false },
          },
        ],
        policy,
      ),
    /inconsistent grounding attestations/,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            selection: { tool_id: null },
          },
        ],
        policy,
      ),
    /inconsistent grounding attestations/,
  );
});

test('requires a categorical error stage and safe optional reason code', () => {
  const [record] = sanitizePublicRecords(
    [
      rawRecord({
        status: 'failed',
        selection: { tool_id: null },
        inspection: { returned_tool_ids: [], required_parameters: [] },
        parameters: null,
        call: { attempted: false, success: null },
        error: { stage: 'adapter', reason_code: 'model_failed' },
      }),
    ],
    policy,
    tasks,
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            error: { stage: null, reason_code: null },
          },
        ],
        policy,
      ),
    /error codes are invalid/,
  );
  assert.doesNotThrow(() =>
    validatePublicRecords(
      [
        {
          ...record,
          error: { stage: 'adapter', reason_code: null },
        },
      ],
      policy,
    ),
  );
  assert.throws(
    () =>
      validatePublicRecords(
        [
          {
            ...record,
            error: { stage: 'adapter', reason_code: 'unsafe reason' },
          },
        ],
        policy,
      ),
    /error codes are invalid/,
  );
});

test('publication policy cannot expose parameters or omit a required protected field', () => {
  assert.throws(() => validatePolicy({ ...policy, publish_parameters: true }), /must not publish raw parameter values/);
  assert.throws(
    () =>
      validatePolicy({
        ...policy,
        forbidden_fields: policy.forbidden_fields.filter((field) => field !== 'api_key'),
      }),
    /must forbid protected fields: api_key/,
  );
  assert.throws(
    () =>
      sanitizePublicRecords(
        [
          rawRecord({
            metadata: {
              ...rawRecord().metadata,
              api_base_url: 'https://internal.example/api/v1',
            },
          }),
        ],
        policy,
        tasks,
      ),
    /unapproved public API base URL/,
  );
});

test('official public runs require the exact task digest, execution, and three trials', () => {
  const records = sanitizePublicRecords(
    [1, 2, 3].map((trial) => rawRecord({ run_id: `run-${trial}`, trial })),
    policy,
    tasks,
  );
  assert.doesNotThrow(() => validateOfficialPublicRun(records, { taskSetSha256 }));
  assert.throws(
    () => validateOfficialPublicRun(records, { taskSetSha256: 'b'.repeat(64) }),
    /task-set digest does not match/,
  );
  assert.throws(() => validateOfficialPublicRun(records.slice(0, 2), { taskSetSha256 }), /at least 3 trials/);
  assert.throws(
    () =>
      validateOfficialPublicRun(
        [
          {
            ...records[0],
            metadata: { ...records[0].metadata, execute: false },
          },
          ...records.slice(1),
        ],
        { taskSetSha256 },
      ),
    /must execute every trial/,
  );
});

function rawRecord(overrides = {}) {
  return {
    schema_version: 1,
    benchmark_version: 'v1',
    run_id: 'run-1',
    model: 'model-a',
    metadata: {
      lane: 'configured-model',
      task_set_sha256: taskSetSha256,
      api_base_url: 'https://qveris.ai/api/v1',
      discovery_limit: 10,
      execute: true,
    },
    task_id: task.id,
    trial: 1,
    status: 'completed',
    started_at: '2026-07-23T00:00:00.000Z',
    discovery: { result_tool_ids: ['weather.tool'] },
    selection: { tool_id: 'weather.tool' },
    inspection: { returned_tool_ids: ['weather.tool'], required_parameters: ['city'] },
    parameters: { city: 'Shanghai' },
    call: { attempted: true, success: true, result_nonempty: true },
    finished_at: '2026-07-23T00:00:01.000Z',
    ...overrides,
  };
}
