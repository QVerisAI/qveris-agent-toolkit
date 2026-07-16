import assert from 'node:assert/strict';
import test from 'node:test';

import { runBenchmark, validateTask } from '../src/harness.mjs';

const task = {
  id: 'weather-london',
  prompt: 'Weather for London',
  discover_query: 'weather forecast API',
  constraints: [{ id: 'location', aliases: ['city'], value: 'London' }],
};

test('orchestrates discover, select, inspect, parameterize, and call', async () => {
  const events = [];
  const records = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover(input) {
        events.push(['discover', input]);
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect(input) {
        events.push(['inspect', input]);
        return { results: [{ tool_id: 'weather.forecast', params: [{ name: 'city', required: true }] }] };
      },
      async call(input) {
        events.push(['call', input]);
        return { success: true, execution_id: 'exec-1' };
      },
    },
    async invokeAdapter(payload) {
      assert.equal('constraints' in payload.input, false);
      assert.equal(payload.messages.length, 2);
      assert.equal(payload.messages[1].content, JSON.stringify(payload.input));
      events.push([payload.stage, payload.input.task_id]);
      return payload.stage === 'select' ? { tool_id: 'weather.forecast' } : { parameters: { city: 'London' } };
    },
    metadata: { adapter_revision: 'adapter-sha' },
    now: () => '2026-07-15T00:00:00.000Z',
    newRunId: () => 'run-1',
  });

  assert.deepEqual(
    events.map((event) => event[0]),
    ['discover', 'select', 'inspect', 'parameterize', 'call'],
  );
  assert.equal(records[0].status, 'completed');
  assert.deepEqual(records[0].inspection.required_parameters, ['city']);
  assert.equal(records[0].call.success, true);
  assert.equal(records[0].call.execution_id, 'exec-1');
  assert.equal(records[0].metadata.adapter_revision, 'adapter-sha');
});

test('records adapter failures without copying their error text', async () => {
  const records = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    api: {
      async discover() {
        return { results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        throw new Error('not reached');
      },
      async call() {
        throw new Error('not reached');
      },
    },
    async invokeAdapter() {
      const error = new Error('adapter failed with secret-token');
      error.benchmarkStage = 'adapter';
      throw error;
    },
  });

  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].error.stage, 'adapter');
  assert.equal(records[0].error.message, 'Adapter invocation failed');
  assert.equal(JSON.stringify(records[0]).includes('secret-token'), false);
});

test('validates task constraints and trial bounds', async () => {
  assert.throws(() => validateTask({ id: 'bad', prompt: 'x', constraints: [] }), /constraints/);
  await assert.rejects(
    runBenchmark({ tasks: [task], model: 'model-a', trials: 0, api: {}, invokeAdapter() {} }),
    /trials/,
  );
});

test('keeps selected_tool explicit when inspection returns no tools', async () => {
  let parameterizeInput;
  await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    api: {
      async discover() {
        return { results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        return { results: [] };
      },
      async call() {
        throw new Error('not reached');
      },
    },
    async invokeAdapter(payload) {
      if (payload.stage === 'parameterize') {
        parameterizeInput = payload.input;
        return { parameters: {} };
      }
      return { tool_id: 'weather.forecast' };
    },
  });

  assert.equal(Object.hasOwn(parameterizeInput, 'selected_tool'), true);
  assert.equal(parameterizeInput.selected_tool, null);
});
