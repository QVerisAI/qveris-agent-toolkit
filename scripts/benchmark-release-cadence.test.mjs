import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicArtifactSafe,
  buildCadencePlan,
  buildResultSection,
  insertResultSection,
  parseTaskSet,
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

test('cadence manifest tamper matrix rejects executable substitutions, unknown fields, and runner-limit drift', () => {
  const cases = [
    ['top-level unknown field', { ...config, maximum_billed_calls: 1 }, /unknown: maximum_billed_calls/],
    [
      'reference unknown field',
      { ...config, reference: { ...config.reference, task_set: config.task_set } },
      /reference has invalid fields/,
    ],
    [
      'configured unknown field',
      { ...config, configured_model: { ...config.configured_model, fallback_model: 'other' } },
      /configured_model has invalid fields/,
    ],
    [
      'reference adapter traversal',
      {
        ...config,
        reference: {
          ...config.reference,
          adapter: 'benchmarks/discover-call/adapters/../../../scripts/benchmark-release-cadence.mjs',
        },
      },
      /reference\.adapter must be/,
    ],
    [
      'configured adapter substitution',
      {
        ...config,
        configured_model: {
          ...config.configured_model,
          adapter: 'benchmarks/discover-call/adapters/claude-cli.mjs',
        },
      },
      /configured_model\.adapter must be/,
    ],
    [
      'CLI package substitution',
      {
        ...config,
        configured_model: { ...config.configured_model, cli_package: 'alternate-codex-package' },
      },
      /configured_model\.cli_package must be/,
    ],
    [
      'reference identity substitution',
      { ...config, reference: { ...config.reference, model_revision: 'unreported' } },
      /reference model identity/,
    ],
    ['trial overflow', { ...config, trials: 101 }, /runner limit of 100/],
    ['discovery overflow', { ...config, discovery_limit: 101 }, /runner limit of 100/],
  ];

  for (const [label, candidate, expected] of cases) {
    assert.throws(() => validateCadenceConfig(candidate, { taskCount: 18 }), expected, label);
  }
});

test('task-set parsing matches JSONL comment semantics before the paid plan is approved', () => {
  const task = {
    id: 'task-1',
    prompt: 'Find a tool',
    constraints: [{ id: 'query', aliases: ['q'], value: 'Shanghai' }],
  };
  assert.equal(parseTaskSet(`# reviewed task\n${JSON.stringify(task)}\n\n`).length, 1);
  assert.throws(() => parseTaskSet('# comments only\n'), /At least one benchmark task/);
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

test('cadence plan derives deterministic artifacts and budget', () => {
  const value = plan();
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
