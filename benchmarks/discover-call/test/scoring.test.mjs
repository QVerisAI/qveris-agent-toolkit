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
    call: { attempted: true, success: true },
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
      call: { attempted: true, success: true },
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
      workflow: summary.models[0].workflow_success_rate,
      failures: summary.models[0].failures_by_stage,
    },
    {
      tasks: 1,
      trialsPerTask: 2,
      runs: 2,
      selection: 0.5,
      parameters: 0.5,
      constraints: 0.5,
      calls: 0.5,
      workflow: 0.5,
      failures: {},
    },
  );
  assert.equal(summary.models[0].workflow_success_wilson_95.length, 2);
});

test('rejects run records for unknown tasks', () => {
  assert.throws(
    () => scoreRecords([task], [{ run_id: 'run-unknown', task_id: 'unknown', model: 'model-a', trial: 1 }]),
    /unknown task/,
  );
});

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
});
