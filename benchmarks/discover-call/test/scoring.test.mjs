import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreRecord, scoreRecords } from '../src/scoring.mjs';

const task = {
  id: 'weather-london',
  prompt: 'Weather for London',
  constraints: [{ id: 'location', aliases: ['city', 'location'], value: 'London' }],
};

test('scores a grounded, complete, successful workflow', () => {
  const result = scoreRecord(task, {
    run_id: 'run-1',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: ['weather.forecast'] },
    selection: { tool_id: 'weather.forecast' },
    inspection: { returned_tool_ids: ['weather.forecast'], required_parameters: ['city'] },
    parameters: { city: 'london' },
    call: { attempted: true, success: true, result_nonempty: true },
  });

  assert.equal(result.selection_grounded, true);
  assert.equal(result.inspection_grounded, true);
  assert.equal(result.required_parameter_accuracy, 1);
  assert.equal(result.constraint_accuracy, 1);
  assert.equal(result.call_success, true);
  assert.equal(result.workflow_success, true);
});

test('does not count dry runs as workflow success', () => {
  const result = scoreRecord(task, {
    run_id: 'run-2',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: ['weather.forecast'] },
    selection: { tool_id: 'weather.forecast' },
    inspection: { returned_tool_ids: ['weather.forecast'], required_parameters: ['city'] },
    parameters: { city: 'London' },
    call: { attempted: false, success: null },
  });

  assert.equal(result.call_success, null);
  assert.equal(result.workflow_success, false);
});

test('v3 constraints support composite parameters and explicit URL decoding', () => {
  const exchange = {
    id: 'exchange',
    prompt: 'USD to EUR',
    constraints: [
      { id: 'base', aliases: ['base'], composite_aliases: ['symbol'], value: 'USD' },
      { id: 'quote', aliases: ['quote'], composite_aliases: ['symbol'], value: 'EUR' },
    ],
  };
  const news = {
    id: 'news',
    prompt: 'AI news',
    constraints: [
      {
        id: 'query',
        aliases: ['q'],
        value: 'artificial intelligence',
        match: 'contains',
        normalizers: ['url_decode'],
      },
    ],
  };
  const baseRecord = {
    run_id: 'run',
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: ['tool'] },
    selection: { tool_id: 'tool' },
    inspection: { returned_tool_ids: ['tool'], required_parameters: [] },
    call: { attempted: true, success: true, result_nonempty: true },
  };

  assert.equal(
    scoreRecord(exchange, { ...baseRecord, task_id: exchange.id, parameters: { symbol: 'USD/EUR' } })
      .constraint_accuracy,
    1,
  );
  assert.equal(
    scoreRecord(exchange, {
      ...baseRecord,
      run_id: 'run-reversed',
      task_id: exchange.id,
      parameters: { symbol: 'EUR/USD' },
    }).constraint_accuracy,
    0,
  );
  assert.equal(
    scoreRecord(exchange, {
      ...baseRecord,
      run_id: 'run-substring',
      task_id: exchange.id,
      parameters: { symbol: 'USDT/EUR' },
    }).constraint_accuracy,
    0,
  );
  assert.equal(
    scoreRecord(exchange, {
      ...baseRecord,
      run_id: 'run-compact',
      task_id: exchange.id,
      parameters: { symbol: 'USDEUR' },
    }).constraint_accuracy,
    1,
  );
  assert.equal(
    scoreRecord(news, {
      ...baseRecord,
      run_id: 'run-news',
      task_id: news.id,
      parameters: { q: '%22artificial%20intelligence%22' },
    }).constraint_accuracy,
    1,
  );
});

test('requires a non-empty result when result non-emptiness is recorded', () => {
  const record = {
    run_id: 'run-empty',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: ['weather.forecast'] },
    selection: { tool_id: 'weather.forecast' },
    inspection: { returned_tool_ids: ['weather.forecast'], required_parameters: ['city'] },
    parameters: { city: 'London' },
    call: { attempted: true, success: true, result_nonempty: false },
  };
  const result = scoreRecord(task, record);
  assert.equal(result.call_success, true);
  assert.equal(result.result_nonempty, false);
  assert.equal(result.workflow_success, false);
});

test('aggregates per model with parameter and workflow rates', () => {
  const records = [
    {
      run_id: 'run-1',
      task_id: task.id,
      model: 'model-a',
      trial: 1,
      status: 'completed',
      discovery: { result_tool_ids: ['weather.forecast'] },
      selection: { tool_id: 'weather.forecast' },
      inspection: { returned_tool_ids: ['weather.forecast'], required_parameters: ['city'] },
      parameters: { city: 'London' },
      call: { attempted: true, success: true, result_nonempty: true },
    },
    {
      run_id: 'run-2',
      task_id: task.id,
      model: 'model-a',
      trial: 2,
      status: 'completed',
      discovery: { result_tool_ids: ['weather.forecast'] },
      selection: { tool_id: 'other.tool' },
      inspection: { returned_tool_ids: [], required_parameters: ['city'] },
      parameters: {},
      call: { attempted: true, success: false },
    },
  ];

  const summary = scoreRecords([task], records);
  assert.equal(summary.models.length, 1);
  assert.deepEqual(
    {
      tasks: summary.models[0].tasks,
      trialsPerTask: summary.models[0].trials_per_task,
      runs: summary.models[0].runs,
      selection: summary.models[0].selection_grounded_rate,
      parameters: summary.models[0].required_parameter_accuracy,
      constraints: summary.models[0].constraint_accuracy,
      calls: summary.models[0].call_success_rate,
      preResult: summary.models[0].pre_result_gate_workflow_success_rate,
      workflow: summary.models[0].workflow_success_rate,
      failures: summary.models[0].failures_by_stage,
      failureReasons: summary.models[0].failures_by_reason,
    },
    {
      tasks: 1,
      trialsPerTask: 2,
      runs: 2,
      selection: 0.5,
      parameters: 0.5,
      constraints: 0.5,
      calls: 0.5,
      preResult: 0.5,
      workflow: 0.5,
      failures: {},
      failureReasons: {},
    },
  );
  assert.equal(summary.models[0].workflow_success_task_cluster_bootstrap_95.length, 2);
});

test('does not infer non-empty results when a successful legacy call lacks evidence', () => {
  const record = {
    run_id: 'run-unobserved',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: ['weather.forecast'] },
    selection: { tool_id: 'weather.forecast' },
    inspection: { returned_tool_ids: ['weather.forecast'], required_parameters: ['city'] },
    parameters: { city: 'London' },
    call: { attempted: true, success: true },
  };

  const result = scoreRecord(task, record);
  assert.equal(result.result_nonempty, null);
  assert.equal(result.pre_result_gate_workflow_success, true);
  assert.equal(result.workflow_success, null);

  const summary = scoreRecords([task], [record]);
  assert.equal(summary.models[0].result_nonempty_rate, null);
  assert.equal(summary.models[0].pre_result_gate_workflow_success_rate, 1);
  assert.equal(summary.models[0].workflow_success_rate, null);
  assert.equal(summary.models[0].workflow_success_task_cluster_bootstrap_95, null);
});

test('scores aliases with task-versioned accepted values', () => {
  const btcTask = {
    id: 'crypto-price',
    prompt: 'BTC price',
    constraints: [
      {
        id: 'symbol',
        aliases: ['symbol', 'id'],
        value: 'BTC',
        match: 'contains',
        alias_values: { id: ['1'] },
      },
    ],
  };
  const result = scoreRecord(btcTask, {
    run_id: 'run-btc',
    task_id: btcTask.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { selection_grounded: true },
    selection: { tool_id: 'crypto.tool' },
    inspection: { selection_grounded: true, required_parameters: ['id'] },
    parameters: { id: 1 },
    call: { attempted: true, success: true, result_nonempty: true },
  });

  assert.equal(result.selection_grounded, true);
  assert.equal(result.inspection_grounded, true);
  assert.equal(result.constraint_accuracy, 1);
  assert.equal(result.workflow_success, true);
  assert.equal(
    scoreRecord(btcTask, {
      ...resultRecord({ taskId: btcTask.id }),
      parameters: { id: 10 },
    }).constraint_accuracy,
    0,
  );
});

test('scores sanitized parameterization attestations without publishing parameter values', () => {
  const result = scoreRecord(task, {
    ...resultRecord({ taskId: task.id }),
    parameterization: {
      required_parameter_accuracy: 1,
      constraint_accuracy: 1,
    },
  });

  assert.equal(result.required_parameter_accuracy, 1);
  assert.equal(result.constraint_accuracy, 1);
  assert.equal(result.workflow_success, true);
  assert.throws(
    () =>
      scoreRecord(task, {
        ...resultRecord({ taskId: task.id }),
        parameterization: {
          required_parameter_accuracy: 2,
          constraint_accuracy: 1,
        },
      }),
    /parameterization metrics/,
  );
});

test('rejects run records for unknown tasks', () => {
  assert.throws(
    () => scoreRecords([task], [{ run_id: 'run-unknown', task_id: 'unknown', model: 'model-a', trial: 1 }]),
    /unknown task/,
  );
});

test('rejects duplicate task definitions before scoring', () => {
  assert.throws(
    () =>
      scoreRecords([task, { ...task, prompt: 'Different duplicate definition' }], [resultRecord({ taskId: task.id })]),
    /Duplicate benchmark task id/,
  );
});

function resultRecord({ taskId }) {
  return {
    run_id: `run-${taskId}`,
    task_id: taskId,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { selection_grounded: true },
    selection: { tool_id: 'tool' },
    inspection: { selection_grounded: true, required_parameters: [] },
    call: { attempted: true, success: true, result_nonempty: true },
  };
}

test('rejects missing tasks and duplicate trial numbers', () => {
  const completeRecord = {
    run_id: 'run-1',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    discovery: { result_tool_ids: [] },
    selection: { tool_id: null },
    inspection: { returned_tool_ids: [], required_parameters: [] },
    parameters: {},
    call: { attempted: false, success: null },
  };
  const secondTask = {
    id: 'stock-aapl',
    prompt: 'Price for AAPL',
    constraints: [{ id: 'symbol', aliases: ['symbol'], value: 'AAPL' }],
  };

  assert.throws(() => scoreRecords([task, secondTask], [completeRecord]), /missing task stock-aapl/);
  assert.throws(() => scoreRecords([task], [completeRecord, { ...completeRecord, run_id: 'run-2' }]), /consecutive/);
});

test('rejects duplicate run ids and mixed benchmark conditions', () => {
  const record = {
    run_id: 'run-1',
    task_id: task.id,
    model: 'model-a',
    trial: 1,
    status: 'completed',
    metadata: { adapter_revision: 'adapter-a', execute: true },
    discovery: { result_tool_ids: [] },
    selection: { tool_id: null },
    inspection: { returned_tool_ids: [], required_parameters: [] },
    parameters: {},
    call: { attempted: true, success: false },
  };

  assert.throws(() => scoreRecords([task], [record, { ...record, trial: 2 }]), /Duplicate run_id/);
  assert.throws(
    () =>
      scoreRecords(
        [task],
        [record, { ...record, run_id: 'run-2', trial: 2, metadata: { adapter_revision: 'adapter-b', execute: true } }],
      ),
    /adapter_revision/,
  );
  assert.throws(
    () =>
      scoreRecords(
        [task],
        [
          {
            ...record,
            schema_version: 1,
            metadata: { ...record.metadata, runtime: { node: 'v22', platform: 'linux', arch: 'x64' } },
          },
          {
            ...record,
            run_id: 'run-2',
            trial: 2,
            schema_version: 1,
            metadata: { ...record.metadata, runtime: { node: 'v24', platform: 'linux', arch: 'x64' } },
          },
        ],
      ),
    /runtime/,
  );
  assert.throws(
    () =>
      scoreRecords(
        [task],
        [
          { ...record, schema_version: 1 },
          { ...record, run_id: 'run-2', trial: 2, schema_version: 2 },
        ],
      ),
    /schema_version/,
  );
  assert.throws(
    () =>
      scoreRecords(
        [task],
        [
          { ...record, benchmark_version: 'v1' },
          { ...record, run_id: 'run-2', trial: 2, benchmark_version: 'v2' },
        ],
      ),
    /cannot mix benchmark versions/,
  );
});
