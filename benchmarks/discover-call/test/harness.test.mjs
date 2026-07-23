import assert from 'node:assert/strict';
import test from 'node:test';

import { parameterResponseSchema, runBenchmark, validateTask } from '../src/harness.mjs';

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
        return {
          results: [
            {
              tool_id: 'weather.forecast',
              params: [
                { name: 'city', type: 'string', required: true },
                { name: 'units', type: 'string', required: false, enum: ['metric', 'imperial'] },
              ],
            },
          ],
        };
      },
      async call(input) {
        events.push(['call', input]);
        return { success: true, execution_id: 'exec-1', result: { forecast: [{ temperature: 20 }] } };
      },
    },
    async invokeAdapter(payload) {
      assert.equal('constraints' in payload.input, false);
      assert.equal(payload.messages.length, 2);
      assert.equal(payload.messages[1].content, JSON.stringify(payload.input));
      events.push([payload.stage, payload.input.task_id]);
      if (payload.stage === 'select') return { tool_id: 'weather.forecast' };
      assert.deepEqual(payload.response_schema.properties.parameters.required, ['city', 'units']);
      assert.deepEqual(payload.response_schema.properties.parameters.properties.units.type, ['string', 'null']);
      return { parameters: { city: 'London', units: null } };
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
  assert.deepEqual(records[0].parameters, { city: 'London' });
  assert.equal(records[0].call.success, true);
  assert.equal(records[0].call.result_nonempty, true);
  assert.equal('execution_id' in records[0].call, false);
  assert.equal(records[0].metadata.adapter_revision, 'adapter-sha');
});

test('builds a strict provider-neutral schema from inspected parameters', () => {
  assert.deepEqual(
    parameterResponseSchema({
      params: [
        { name: 'limit', type: 'integer', required: true },
        { name: 'count', type: 'integer', required: false, enum: ['10', '20'] },
        { name: 'spellcheck', type: 'boolean', required: false, enum: ['1'] },
        { name: 'tags', type: 'array', required: false, items: { type: 'string' } },
        {
          name: 'options',
          type: 'object',
          required: false,
          properties: {
            enabled: { type: 'boolean', required: true },
            label: { type: 'string', required: false },
          },
        },
      ],
    }),
    {
      type: 'object',
      additionalProperties: false,
      required: ['parameters'],
      properties: {
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['limit', 'count', 'spellcheck', 'tags', 'options'],
          properties: {
            limit: { type: 'integer' },
            count: { type: ['string', 'null'], enum: ['10', '20', null] },
            spellcheck: { type: ['string', 'null'], enum: ['1', null] },
            tags: { type: ['array', 'null'], items: { type: 'string' } },
            options: {
              type: ['object', 'null'],
              additionalProperties: false,
              required: ['enabled', 'label'],
              properties: {
                enabled: { type: 'boolean' },
                label: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
  );
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
      error.benchmarkReason = 'tool_use_rejected';
      throw error;
    },
  });

  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].error.stage, 'adapter');
  assert.equal(records[0].error.message, 'Adapter invocation failed');
  assert.equal(records[0].error.reason_code, 'tool_use_rejected');
  assert.equal(JSON.stringify(records[0]).includes('secret-token'), false);
});

test('does not inspect or execute a tool outside the discovery results', async () => {
  const events = [];
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        events.push('discover');
        return { results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        events.push('inspect');
        throw new Error('not reached');
      },
      async call() {
        events.push('call');
        throw new Error('not reached');
      },
    },
    async invokeAdapter() {
      events.push('select');
      return { tool_id: 'unrelated.tool' };
    },
  });

  assert.deepEqual(events, ['discover', 'select']);
  assert.equal(record.status, 'failed');
  assert.equal(record.selection.tool_id, 'unrelated.tool');
  assert.equal(record.call.attempted, false);
  assert.deepEqual(record.error, {
    stage: 'select',
    reason_code: 'ungrounded_tool_id',
    message: 'Adapter selected a tool outside the discovery results',
  });
});

test('validates task constraints and trial bounds', async () => {
  assert.throws(() => validateTask({ id: 'bad', prompt: 'x', constraints: [] }), /constraints/);
  assert.throws(
    () =>
      validateTask({
        ...task,
        constraints: [{ ...task.constraints[0], normalizers: ['unknown'] }],
      }),
    /normalizers/,
  );
  assert.throws(() => validateTask({ ...task, oracle: { candidates: [] } }), /unavailable_reason/);
  assert.doesNotThrow(() =>
    validateTask({
      ...task,
      constraints: [{ ...task.constraints[0], alias_values: { city: ['LON'] } }],
      reference: {
        candidates: [{ tool_id: 'weather.forecast', parameters: { city: 'LON' } }],
      },
    }),
  );
  assert.throws(
    () =>
      validateTask({
        ...task,
        constraints: [{ ...task.constraints[0], alias_values: { unknown: ['LON'] } }],
      }),
    /alias_values/,
  );
  await assert.rejects(
    runBenchmark({ tasks: [task], model: 'model-a', trials: 0, api: {}, invokeAdapter() {} }),
    /trials/,
  );
});

test('does not parameterize or execute when inspection omits the selected tool', async () => {
  const events = [];
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        events.push('discover');
        return { results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        events.push('inspect');
        return { results: [{ tool_id: 'different.tool', params: [] }] };
      },
      async call() {
        events.push('call');
        throw new Error('not reached');
      },
    },
    async invokeAdapter(payload) {
      events.push(payload.stage);
      return { tool_id: 'weather.forecast' };
    },
  });

  assert.deepEqual(events, ['discover', 'select', 'inspect']);
  assert.equal(record.status, 'failed');
  assert.deepEqual(record.inspection.returned_tool_ids, ['different.tool']);
  assert.equal(record.call.attempted, false);
  assert.deepEqual(record.error, {
    stage: 'inspect',
    reason_code: 'selected_tool_not_returned',
    message: 'Inspect did not return the selected tool',
  });
});
