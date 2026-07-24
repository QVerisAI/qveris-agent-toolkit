import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicArtifactSafe,
  buildCadencePlan,
  buildResultSection,
  insertResultSection,
  validateCadenceConfig,
} from './benchmark-release-cadence.mjs';

const releaseSha = 'a'.repeat(40);
const releases = [{ tag: 'cli-v1.0.0' }, { tag: 'mcp-v2.0.0' }, { tag: 'js-sdk-v3.0.0' }, { tag: 'python-sdk-v4.0.0' }];
const config = {
  schema_version: 1,
  task_set: 'benchmarks/discover-call/tasks/v4.jsonl',
  task_version: 'v4',
  trials: 3,
  discovery_limit: 10,
  reference: {
    model: 'reference-v1',
    model_revision: 'deterministic-reference-v1',
    adapter: 'benchmarks/discover-call/adapters/reference.mjs',
  },
  configured_model: {
    model: 'gpt-5.6-sol',
    model_revision: 'unreported',
    adapter: 'benchmarks/discover-call/adapters/codex-cli.mjs',
    cli_package: '@openai/codex',
    cli_version: '0.144.1',
    reasoning_effort: 'medium',
  },
};

function plan() {
  return buildCadencePlan({
    config,
    releases,
    releaseSha,
    taskCount: 18,
    tagCommit: () => releaseSha,
    runDate: '2026-07-25',
  });
}

function summary({ model, lane, workflowSuccess, executed = 51, catalogDigest }) {
  const isReference = lane === 'reference';
  const adapterRevision = isReference
    ? `${releaseSha}/reference-v1`
    : `${releaseSha}/codex-cli-${config.configured_model.cli_version}/${config.configured_model.reasoning_effort}`;
  const metadata = {
    discovery_limit: 10,
    model_revision: isReference ? 'deterministic-reference-v1' : 'unreported',
    adapter_revision: adapterRevision,
    toolkit_revision: releaseSha,
    execute: true,
    catalog_observation_sha256: catalogDigest,
  };
  return {
    schema_version: 1,
    methodology: 'discover-call-v2',
    generated_at: '2026-07-25T00:00:00.000Z',
    models: [
      {
        model,
        lane,
        tasks: 18,
        trials_per_task: 3,
        runs: 54,
        completed: executed,
        executed,
        selection_grounded_rate: 1,
        inspection_grounded_rate: 1,
        required_parameter_accuracy: 1,
        constraint_accuracy: workflowSuccess,
        call_success_rate: 1,
        result_nonempty_rate: 1,
        workflow_success_rate: workflowSuccess,
        workflow_success_task_cluster_bootstrap_95: [0.8, 1],
      },
    ],
    records: Array.from({ length: 54 }, () => ({ metadata })),
  };
}

test('cadence config fixes an official three-trial budget', () => {
  assert.deepEqual(validateCadenceConfig(config, { taskCount: 18 }), {
    recordsPerLane: 54,
    maximumBilledCalls: 108,
  });
});

test('cadence config rejects mutable task names and non-exact CLI versions', () => {
  assert.throws(
    () => validateCadenceConfig({ ...config, task_set: 'benchmarks/discover-call/tasks/latest.jsonl' }),
    /versioned discover-call task file/,
  );
  assert.throws(
    () =>
      validateCadenceConfig({
        ...config,
        configured_model: { ...config.configured_model, cli_version: 'latest' },
      }),
    /exact semantic version/,
  );
});

test('cadence plan requires all four release tags at the release commit', () => {
  assert.throws(
    () =>
      buildCadencePlan({
        config,
        releases,
        releaseSha,
        taskCount: 18,
        tagCommit: (tag) => (tag.startsWith('mcp-') ? 'b'.repeat(40) : releaseSha),
      }),
    /mcp-v2\.0\.0 points to/,
  );
});

test('cadence plan derives deterministic branch, artifacts, and budget', () => {
  const value = plan();
  assert.equal(value.branch, 'benchmark/cadence-aaaaaaaaaaaa');
  assert.equal(value.referenceStem, '2026-07-25-reference-v1-release-aaaaaaaaaaaa-v4');
  assert.equal(value.configuredStem, '2026-07-25-gpt-5.6-sol-configured-release-aaaaaaaaaaaa-v4');
  assert.equal(value.recordsPerLane, 54);
  assert.equal(value.maximumBilledCalls, 108);
});

test('generated result copy preserves denominators and comparison caveats', () => {
  const section = buildResultSection({
    referenceSummary: summary({
      model: 'reference-v1',
      lane: 'reference',
      workflowSuccess: 51 / 54,
      catalogDigest: '1'.repeat(64),
    }),
    configuredSummary: summary({
      model: 'gpt-5.6-sol',
      lane: 'configured-model',
      workflowSuccess: 48 / 54,
      executed: 52,
      catalogDigest: '2'.repeat(64),
    }),
    plan: plan(),
    generatedAt: '2026-07-25T12:00:00.000Z',
  });
  assert.match(section, /51\/54/);
  assert.match(section, /48\/54/);
  assert.match(section, /5\.56 percentage points/);
  assert.match(section, /not automatically a pure routing effect/);
  assert.match(section, /must not\s+be described as a pinned-model snapshot/);
});

test('generated result copy rejects a summary from another release commit', () => {
  const configured = summary({
    model: 'gpt-5.6-sol',
    lane: 'configured-model',
    workflowSuccess: 48 / 54,
    executed: 52,
    catalogDigest: '2'.repeat(64),
  });
  configured.records[0].metadata = {
    ...configured.records[0].metadata,
    toolkit_revision: 'b'.repeat(40),
  };
  assert.throws(
    () =>
      buildResultSection({
        referenceSummary: summary({
          model: 'reference-v1',
          lane: 'reference',
          workflowSuccess: 51 / 54,
          catalogDigest: '1'.repeat(64),
        }),
        configuredSummary: configured,
        plan: plan(),
        generatedAt: '2026-07-25T12:00:00.000Z',
      }),
    /provenance does not match/,
  );
});

test('result insertion is idempotent per release SHA', () => {
  const inserted = insertResultSection('# Published benchmark results\n\nOld\n', 'New', releaseSha);
  assert.equal(inserted, '# Published benchmark results\n\nNew\n\nOld\n');
  assert.throws(
    () =>
      insertResultSection(
        `# Published benchmark results\n\n<!-- benchmark-cadence:${releaseSha} -->\n`,
        'New',
        releaseSha,
      ),
    /already contains/,
  );
});

test('public artifact scan rejects operational identifiers recursively', () => {
  assert.doesNotThrow(() => assertPublicArtifactSafe({ metadata: { release_sha: releaseSha } }));
  assert.throws(
    () => assertPublicArtifactSafe({ records: [{ metadata: { execution_id: 'private' } }] }),
    /Forbidden public field/,
  );
});
