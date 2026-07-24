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
  const checkpointSizes = [];
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
              one_of_required: [],
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
      if (payload.stage === 'select') {
        assert.equal('search_id' in payload.input.discovery, false);
        return { tool_id: 'weather.forecast' };
      }
      assert.equal('discovery_id' in payload.input, false);
      assert.deepEqual(Object.keys(payload.input.selected_tool).sort(), ['one_of_required', 'params', 'tool_id']);
      assert.deepEqual(payload.response_schema.properties.parameters.required, ['city', 'units']);
      assert.deepEqual(payload.response_schema.properties.parameters.properties.units.type, ['string', 'null']);
      return { parameters: { city: 'London', units: null } };
    },
    metadata: { adapter_revision: 'adapter-sha' },
    now: () => '2026-07-15T00:00:00.000Z',
    newRunId: () => 'run-1',
    newSessionId: () => 'session-1',
    async onRecord(records) {
      checkpointSizes.push(records.length);
    },
  });

  assert.deepEqual(
    events.map((event) => event[0]),
    ['discover', 'select', 'inspect', 'parameterize', 'call'],
  );
  assert.equal(records[0].status, 'completed');
  assert.equal(records[0].benchmark_version, 'v2');
  assert.deepEqual(records[0].inspection.required_parameters, ['city']);
  assert.deepEqual(records[0].parameters, { city: 'London' });
  assert.equal(records[0].call.success, true);
  assert.equal(records[0].call.result_nonempty, true);
  assert.equal('execution_id' in records[0].call, false);
  assert.equal(records[0].metadata.adapter_revision, 'adapter-sha');
  assert.equal(events[0][1].sessionId, 'session-1');
  assert.equal(events[2][1].sessionId, 'session-1');
  assert.equal(events[4][1].sessionId, 'session-1');
  assert.equal(events[4][1].model, 'model-a');
  assert.deepEqual(checkpointSizes, [1]);
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
  assert.doesNotThrow(() => parameterResponseSchema({ params: [], one_of_required: [] }));
  const prototypeNamedSchema = parameterResponseSchema({
    params: [{ name: '__proto__', type: 'string', required: true }],
  });
  assert.equal(Object.hasOwn(prototypeNamedSchema.properties.parameters.properties, '__proto__'), true);
  assert.deepEqual(prototypeNamedSchema.properties.parameters.required, ['__proto__']);
});

test('rejects required object parameters without a usable property schema', () => {
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [{ name: 'payload', type: 'object', required: true }],
      }),
    (error) =>
      error.benchmarkStage === 'parameterize' &&
      error.benchmarkReason === 'unsupported_parameter_schema' &&
      /payload/.test(error.message),
  );
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [{ name: 'items', type: 'array', required: true }],
      }),
    (error) =>
      error.benchmarkStage === 'parameterize' &&
      error.benchmarkReason === 'unsupported_parameter_schema' &&
      /items/.test(error.message),
  );
  assert.deepEqual(
    parameterResponseSchema({
      params: [
        { name: 'payload', type: 'object', required: false },
        { name: 'items', type: 'array', required: false },
      ],
    }).properties.parameters.properties,
    {
      payload: { type: 'null' },
      items: { type: 'null' },
    },
  );
});

test('rejects ambiguous inspected parameter metadata instead of guessing', () => {
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'query', type: 'number', required: false },
        ],
      }),
    (error) => error.benchmarkReason === 'unsupported_parameter_schema',
  );
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [{ name: 'query', type: 'unknown', required: true }],
      }),
    (error) => error.benchmarkReason === 'unsupported_parameter_schema',
  );
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [{ name: 'query', type: 'string' }],
      }),
    (error) => error.benchmarkReason === 'unsupported_parameter_schema',
  );
  assert.throws(
    () =>
      parameterResponseSchema({
        params: [{ name: 'query', type: 'string', required: true, enum: { unsafe: true } }],
      }),
    (error) => error.benchmarkReason === 'unsupported_parameter_schema',
  );
});

test('does not invoke parameterization or a billed call for an opaque required parameter', async () => {
  const events = [];
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        events.push('discover');
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        events.push('inspect');
        return {
          results: [
            {
              tool_id: 'weather.forecast',
              params: [{ name: 'payload', type: 'object', required: true }],
            },
          ],
        };
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
  assert.equal(record.call.attempted, false);
  assert.deepEqual(record.error, {
    stage: 'parameterize',
    reason_code: 'unsupported_parameter_schema',
    message: 'Required object parameter payload has no property schema',
  });
});

test('records adapter failures without copying their error text', async () => {
  const records = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    api: {
      async discover() {
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
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

test('checks the full result data instead of treating its wrapper as non-empty', async () => {
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        return {
          results: [
            {
              tool_id: 'weather.forecast',
              params: [{ name: 'city', type: 'string', required: true }],
            },
          ],
        };
      },
      async call() {
        return { success: true, result: { data: {} } };
      },
    },
    async invokeAdapter(payload) {
      return payload.stage === 'select' ? { tool_id: 'weather.forecast' } : { parameters: { city: 'London' } };
    },
  });

  assert.equal(record.status, 'completed');
  assert.equal(record.call.success, true);
  assert.equal(record.call.result_nonempty, false);
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
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
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
  assert.throws(
    () =>
      validateTask({
        ...task,
        constraints: [task.constraints[0], { ...task.constraints[0] }],
      }),
    /duplicate constraint id/,
  );
  assert.throws(
    () =>
      validateTask({
        ...task,
        constraints: [{ ...task.constraints[0], value: Number.POSITIVE_INFINITY }],
      }),
    /primitive finite value/,
  );
  assert.throws(() => validateTask({ ...task, discover_query: 123 }), /discover_query/);
  assert.throws(
    () =>
      validateTask({
        ...task,
        constraints: [{ ...task.constraints[0], aliases: ['city', 'city'] }],
      }),
    /string aliases/,
  );
  assert.throws(
    () =>
      validateTask({
        ...task,
        reference: {
          candidates: [
            { tool_id: 'weather.forecast', parameters: { city: 'London' } },
            { tool_id: 'weather.forecast', parameters: { city: 'Paris' } },
          ],
        },
      }),
    /unique tool ids/,
  );
  await assert.rejects(
    runBenchmark({ tasks: [task], model: 'model-a', trials: 0, api: {}, invokeAdapter() {} }),
    /trials/,
  );
});

test('validates the complete task set before any external call', async () => {
  let externalCalls = 0;
  const api = {
    async discover() {
      externalCalls++;
      return { results: [] };
    },
    async inspect() {
      externalCalls++;
      return { results: [] };
    },
    async call() {
      externalCalls++;
      return { success: false };
    },
  };
  await assert.rejects(
    runBenchmark({
      tasks: [task, { ...task }],
      model: 'model-a',
      api,
      async invokeAdapter() {
        externalCalls++;
        return {};
      },
    }),
    /Duplicate benchmark task id/,
  );
  assert.equal(externalCalls, 0);
});

test('validates execution controls and all run ids before external calls', async () => {
  let externalCalls = 0;
  const api = {
    async discover() {
      externalCalls++;
      return { search_id: 'search-1', results: [] };
    },
    async inspect() {
      externalCalls++;
      return { results: [] };
    },
    async call() {
      externalCalls++;
      return { success: false };
    },
  };
  const invokeAdapter = async () => {
    externalCalls++;
    return {};
  };

  await assert.rejects(
    runBenchmark({ tasks: [task], model: 'model-a', execute: 'false', api, invokeAdapter }),
    /execute must be a boolean/,
  );
  await assert.rejects(
    runBenchmark({ tasks: [task], model: 'model-a', limit: 0, api, invokeAdapter }),
    /limit must be an integer/,
  );
  await assert.rejects(
    runBenchmark({
      tasks: [task],
      model: 'model-a',
      trials: 2,
      api,
      invokeAdapter,
      newRunId: () => 'duplicate-run',
    }),
    /Duplicate benchmark run id/,
  );
  let runId = 0;
  await assert.rejects(
    runBenchmark({
      tasks: [task],
      model: 'model-a',
      trials: 2,
      api,
      invokeAdapter,
      newRunId: () => `run-${++runId}`,
      newSessionId: () => 'duplicate-session',
    }),
    /Duplicate benchmark session id/,
  );
  await assert.rejects(
    runBenchmark({
      tasks: [task],
      model: 'model-a',
      trials: 1,
      api,
      invokeAdapter,
      newRunId: () => 'shared-id',
      newSessionId: () => 'shared-id',
    }),
    /run and session ids must be disjoint/,
  );
  let plannedRun = 0;
  let plannedSession = 0;
  await assert.rejects(
    runBenchmark({
      tasks: [task],
      model: 'model-a',
      trials: 2,
      api,
      invokeAdapter,
      newRunId: () => ['run-1', 'session-1'][plannedRun++],
      newSessionId: () => ['session-1', 'session-2'][plannedSession++],
    }),
    /run and session ids must be disjoint/,
  );
  assert.equal(externalCalls, 0);
});

test('prototype-named parameters cannot bypass the billed-call gate', async () => {
  let callCount = 0;
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        return {
          results: [
            {
              tool_id: 'weather.forecast',
              params: [{ name: 'toString', type: 'string', required: true }],
            },
          ],
        };
      },
      async call() {
        callCount++;
        return { success: true, result: { data: 'unexpected' } };
      },
    },
    async invokeAdapter(payload) {
      return payload.stage === 'select' ? { tool_id: 'weather.forecast' } : { parameters: {} };
    },
  });

  assert.equal(callCount, 0);
  assert.equal(record.status, 'failed');
  assert.equal(record.error.stage, 'parameterize');
  assert.equal(record.error.reason_code, 'invalid_parameter_values');
});

test('stops before selection when discover omits its correlation id', async () => {
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
      events.push('adapter');
      return {};
    },
  });

  assert.deepEqual(events, ['discover']);
  assert.deepEqual(record.error, {
    stage: 'discover',
    reason_code: 'missing_search_id',
    message: 'Discover did not return a search_id',
  });
  assert.equal(record.call.attempted, false);
});

test('validates adapter parameters and one-of requirements before a billed call', async () => {
  const variants = [
    { parameters: {}, message: /omitted required parameter city/ },
    { parameters: { city: 123 }, message: /invalid string value/ },
    { parameters: { city: 'London', units: 'kelvin' }, message: /outside the parameter enum/ },
    { parameters: { city: 'London', unknown: true }, message: /unknown parameter unknown/ },
    { parameters: { city: 'London' }, oneOf: [['query', 'url']], message: /one_of_required group/ },
  ];

  for (const [index, variant] of variants.entries()) {
    let calls = 0;
    const [record] = await runBenchmark({
      tasks: [task],
      model: 'model-a',
      trials: 1,
      execute: true,
      api: {
        async discover() {
          return { search_id: `search-${index}`, results: [{ tool_id: 'weather.forecast' }] };
        },
        async inspect() {
          return {
            results: [
              {
                tool_id: 'weather.forecast',
                params: [
                  { name: 'city', type: 'string', required: true },
                  { name: 'units', type: 'string', required: false, enum: ['metric', 'imperial'] },
                  { name: 'query', type: 'string', required: false },
                  { name: 'url', type: 'string', required: false },
                ],
                ...(variant.oneOf ? { one_of_required: variant.oneOf } : {}),
              },
            ],
          };
        },
        async call() {
          calls++;
          return { success: true, result: { data: { ok: true } } };
        },
      },
      async invokeAdapter(payload) {
        return payload.stage === 'select' ? { tool_id: 'weather.forecast' } : variant;
      },
    });

    assert.equal(calls, 0);
    assert.equal(record.error.stage, 'parameterize');
    assert.equal(record.error.reason_code, 'invalid_parameter_values');
    assert.match(record.error.message, variant.message);
  }
});

test('adapter projections cannot mutate the inspected schema used for call validation', async () => {
  let calls = 0;
  const [record] = await runBenchmark({
    tasks: [task],
    model: 'model-a',
    trials: 1,
    execute: true,
    api: {
      async discover() {
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
      },
      async inspect() {
        return {
          results: [
            {
              tool_id: 'weather.forecast',
              params: [{ name: 'city', type: 'string', required: true }],
            },
          ],
        };
      },
      async call() {
        calls++;
        return { success: true, result: { data: { ok: true } } };
      },
    },
    async invokeAdapter(payload) {
      if (payload.stage === 'select') return { tool_id: 'weather.forecast' };
      payload.input.selected_tool.params[0].required = false;
      return { parameters: {} };
    },
  });

  assert.equal(calls, 0);
  assert.equal(record.error.stage, 'parameterize');
  assert.equal(record.error.reason_code, 'invalid_parameter_values');
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
        return { search_id: 'search-1', results: [{ tool_id: 'weather.forecast' }] };
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
