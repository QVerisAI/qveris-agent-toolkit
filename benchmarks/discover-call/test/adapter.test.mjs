import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessAdapter, main } from '../src/run.mjs';
import { buildClaudeInvocation, parseClaudeEnvelope } from '../adapters/claude-cli.mjs';

const adapterPath = resolve(fileURLToPath(new URL('../adapters/first-result.mjs', import.meta.url)));

test('process adapter exchanges one JSON object without shell parsing', async () => {
  const invoke = createProcessAdapter({ command: process.execPath, args: [adapterPath], timeoutMs: 5_000 });
  const selected = await invoke({
    stage: 'select',
    input: { discovery: { results: [{ tool_id: 'weather.forecast' }] } },
  });
  const parameterized = await invoke({
    stage: 'parameterize',
    input: { selected_tool: { tool_id: 'weather.forecast' } },
  });

  assert.deepEqual(selected, { tool_id: 'weather.forecast' });
  assert.deepEqual(parameterized, { parameters: {} });
});

test('process adapter cannot read the QVeris API key', async () => {
  const previous = process.env.QVERIS_API_KEY;
  process.env.QVERIS_API_KEY = 'must-not-reach-adapter';
  try {
    const invoke = createProcessAdapter({
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({visible: Boolean(process.env.QVERIS_API_KEY)})))",
      ],
      timeoutMs: 5_000,
    });
    assert.deepEqual(await invoke({ stage: 'select' }), { visible: false });
  } finally {
    if (previous === undefined) delete process.env.QVERIS_API_KEY;
    else process.env.QVERIS_API_KEY = previous;
  }
});

test('runner requires an immutable adapter revision before API setup', async () => {
  await assert.rejects(main(['--model', 'model-a', '--adapter', process.execPath]), /adapter-revision/);
});

test('process adapter reports startup failures without an unhandled stdin error', async () => {
  const invoke = createProcessAdapter({
    command: `missing-adapter-${process.pid}`,
    timeoutMs: 5_000,
  });
  await assert.rejects(invoke({ stage: 'select' }), /could not be started/);
});

test('Claude adapter preserves canonical messages and response schema', () => {
  const payload = {
    model: 'claude-sonnet-5',
    messages: [
      { role: 'system', content: 'Return one grounded tool.' },
      { role: 'user', content: '{"input":"unchanged"}' },
    ],
    response_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tool_id'],
      properties: { tool_id: { type: 'string' } },
    },
  };

  const invocation = buildClaudeInvocation(payload);
  assert.equal(invocation.stdin, payload.messages[1].content);
  assert.equal(invocation.args[invocation.args.indexOf('--system-prompt') + 1], payload.messages[0].content);
  assert.deepEqual(JSON.parse(invocation.args[invocation.args.indexOf('--json-schema') + 1]), payload.response_schema);
  assert.equal(invocation.args[invocation.args.indexOf('--model') + 1], payload.model);
  assert.equal(invocation.args.includes('--safe-mode'), true);
  assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], '');
});

test('Claude adapter extracts only structured model output', () => {
  assert.deepEqual(
    parseClaudeEnvelope(JSON.stringify({ type: 'result', structured_output: { tool_id: 'weather.forecast' } })),
    { tool_id: 'weather.forecast' },
  );
  assert.deepEqual(parseClaudeEnvelope(JSON.stringify({ result: '{"parameters":{"city":"London"}}' })), {
    parameters: { city: 'London' },
  });
  assert.throws(
    () => parseClaudeEnvelope(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true })),
    /unsuccessful result/,
  );
  assert.throws(
    () => parseClaudeEnvelope(JSON.stringify({ type: 'result', is_error: true, result: '{"tool_id":"wrong"}' })),
    /unsuccessful result/,
  );
  assert.throws(() => parseClaudeEnvelope(JSON.stringify({ result: 'not-json' })), /no structured output/);
});
