import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessAdapter, main, resolveToolkitRevision } from '../src/run.mjs';
import { buildClaudeInvocation, parseClaudeEnvelope, runClaude } from '../adapters/claude-cli.mjs';
import { buildCodexInvocation, CODEX_REASONING_EFFORT, parseCodexEvents, runCodex } from '../adapters/codex-cli.mjs';

const adapterPath = resolve(fileURLToPath(new URL('../adapters/first-result.mjs', import.meta.url)));
const referenceAdapterPath = resolve(fileURLToPath(new URL('../adapters/reference.mjs', import.meta.url)));
const v4TasksPath = resolve(fileURLToPath(new URL('../tasks/v4.jsonl', import.meta.url)));

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

test('process adapter cannot read QVeris environment values', async () => {
  const previousKey = process.env.QVERIS_API_KEY;
  const previousToken = process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
  process.env.QVERIS_API_KEY = 'must-not-reach-adapter';
  process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = 'must-also-not-reach-adapter';
  try {
    const invoke = createProcessAdapter({
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({visible: Object.keys(process.env).some((name) => name.startsWith('QVERIS_'))})))",
      ],
      timeoutMs: 5_000,
    });
    assert.deepEqual(await invoke({ stage: 'select' }), { visible: false });
  } finally {
    if (previousKey === undefined) delete process.env.QVERIS_API_KEY;
    else process.env.QVERIS_API_KEY = previousKey;
    if (previousToken === undefined) delete process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
    else process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = previousToken;
  }
});

test('runner requires an immutable adapter revision before API setup', async () => {
  await assert.rejects(main(['--model', 'model-a', '--adapter', process.execPath]), /adapter-revision/);
  await assert.rejects(
    main([
      '--model',
      'reference-v1',
      '--lane',
      'reference',
      '--adapter',
      process.execPath,
      '--adapter-revision',
      'adapter-sha',
      '--tasks',
      v4TasksPath,
    ]),
    /model-revision.*reference/,
  );
});

test('runner records only commit-shaped toolkit revisions from a clean checkout', () => {
  const sha = 'a'.repeat(40);
  const cleanGit = {
    githubSha: '',
    execFile(_command, args) {
      return args[0] === 'status' ? '' : `${sha}\n`;
    },
  };
  assert.equal(resolveToolkitRevision(sha.toUpperCase(), cleanGit), sha);
  assert.throws(() => resolveToolkitRevision('main'), /commit SHA/);
  assert.equal(resolveToolkitRevision(undefined, cleanGit), sha);
  assert.throws(
    () =>
      resolveToolkitRevision(sha, {
        githubSha: '',
        execFile(_command, args) {
          return args[0] === 'status' ? ' M benchmarks/discover-call/src/run.mjs\n' : `${sha}\n`;
        },
      }),
    /tracked changes/,
  );
});

test('process adapter reports startup failures without an unhandled stdin error', async () => {
  const invoke = createProcessAdapter({
    command: `missing-adapter-${process.pid}`,
    timeoutMs: 5_000,
  });
  await assert.rejects(invoke({ stage: 'select' }), (error) => {
    assert.equal(error.benchmarkReason, 'start_failed');
    return /could not be started/.test(error.message);
  });
});

test('process adapter records safe failure reasons without provider stderr', async () => {
  const invoke = createProcessAdapter({
    command: process.execPath,
    args: [
      '-e',
      "process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('private body\\nQVERIS_BENCHMARK_ADAPTER_ERROR=tool_use_rejected\\n'); process.exitCode = 2; })",
    ],
    timeoutMs: 5_000,
  });
  await assert.rejects(invoke({ stage: 'select' }), (error) => {
    assert.equal(error.benchmarkReason, 'tool_use_rejected');
    assert.equal(error.message.includes('private body'), false);
    return true;
  });
});

test('process adapter classifies timeouts', async () => {
  const invoke = createProcessAdapter({
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
    timeoutMs: 25,
  });
  await assert.rejects(invoke({ stage: 'select' }), (error) => {
    assert.equal(error.benchmarkReason, 'timeout');
    return true;
  });
});

test('process adapter force-kills a child that ignores SIGTERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qveris-adapter-test-'));
  const pidPath = join(directory, 'pid');
  try {
    const invoke = createProcessAdapter({
      command: process.execPath,
      args: [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000)",
        pidPath,
      ],
      timeoutMs: 50,
      forceKillAfterMs: 20,
    });
    await assert.rejects(invoke({ stage: 'select' }), /timed out/);
    const pid = Number(await readFile(pidPath, 'utf8'));
    assert.equal(await waitForProcessExit(pid), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reference adapter selects only configured candidates present in discovery', async () => {
  const taskSetSha256 = createHash('sha256')
    .update(await readFile(v4TasksPath))
    .digest('hex');
  const invoke = createProcessAdapter({
    command: process.execPath,
    args: [referenceAdapterPath, v4TasksPath],
    timeoutMs: 5_000,
  });
  assert.deepEqual(
    await invoke({
      stage: 'select',
      task_set_sha256: taskSetSha256,
      input: {
        task_id: 'weather-london',
        discovery: {
          results: [{ tool_id: 'unrelated.tool' }, { tool_id: 'visualcrossing.timeline.retrieve.v1' }],
        },
      },
    }),
    { tool_id: 'visualcrossing.timeline.retrieve.v1' },
  );
  assert.deepEqual(
    await invoke({
      stage: 'parameterize',
      task_set_sha256: taskSetSha256,
      input: {
        task_id: 'weather-london',
        selected_tool: { tool_id: 'visualcrossing.timeline.retrieve.v1' },
      },
    }),
    { parameters: { location: 'London', unitGroup: 'metric', contentType: 'json' } },
  );
  assert.deepEqual(
    await invoke({
      stage: 'select',
      task_set_sha256: taskSetSha256,
      input: {
        task_id: 'timezone-tokyo',
        discovery: { results: [{ tool_id: 'api_sports.timezone.retrieve.v1.e993615d' }] },
      },
    }),
    { tool_id: null },
  );
  await assert.rejects(
    invoke({
      stage: 'select',
      task_set_sha256: '0'.repeat(64),
      input: {
        task_id: 'weather-london',
        discovery: { results: [{ tool_id: 'visualcrossing.timeline.retrieve.v1' }] },
      },
    }),
    (error) => error.benchmarkReason === 'task_set_mismatch',
  );
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

test('Claude adapter removes QVeris environment values from its model subprocess', async () => {
  const previousKey = process.env.QVERIS_API_KEY;
  const previousToken = process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
  process.env.QVERIS_API_KEY = 'must-not-reach-model';
  process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = 'must-also-not-reach-model';
  try {
    const output = await runClaude({
      command: process.execPath,
      args: ['-e', "process.stdout.write(String(Object.keys(process.env).some((name) => name.startsWith('QVERIS_'))))"],
      stdin: '',
    });
    assert.equal(output, 'false');
  } finally {
    if (previousKey === undefined) delete process.env.QVERIS_API_KEY;
    else process.env.QVERIS_API_KEY = previousKey;
    if (previousToken === undefined) delete process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
    else process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = previousToken;
  }
});

test('Claude adapter force-kills a child that ignores the output-limit signal', async () => {
  await assert.rejects(
    runClaude(
      {
        command: process.execPath,
        args: [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)",
        ],
        stdin: '',
      },
      { outputLimit: 10, forceKillAfterMs: 20 },
    ),
    /output exceeded/,
  );
});

test('Codex adapter preserves canonical messages and response schema', () => {
  const payload = {
    model: 'gpt-5.6-sol',
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

  const invocation = buildCodexInvocation(payload, {
    schemaPath: '/tmp/response-schema.json',
    workingDirectory: '/tmp/codex-adapter',
  });
  const configs = invocation.args
    .map((value, index) => (value === '--config' ? invocation.args[index + 1] : undefined))
    .filter(Boolean);

  assert.equal(invocation.stdin, payload.messages[1].content);
  assert.deepEqual(invocation.schema, payload.response_schema);
  assert.equal(invocation.args[invocation.args.indexOf('--model') + 1], payload.model);
  assert.equal(invocation.args[invocation.args.indexOf('--output-schema') + 1], '/tmp/response-schema.json');
  assert.equal(configs.includes(`developer_instructions=${JSON.stringify(payload.messages[0].content)}`), true);
  assert.equal(configs.includes(`model_reasoning_effort=${JSON.stringify(CODEX_REASONING_EFFORT)}`), true);
  assert.equal(invocation.args.includes('--ephemeral'), true);
  assert.equal(invocation.args.includes('--ignore-user-config'), true);
  assert.equal(invocation.args.includes('--ignore-rules'), true);
  assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'read-only');
});

test('Codex adapter extracts the final structured message and rejects tool use', () => {
  assert.deepEqual(
    parseCodexEvents(
      [
        JSON.stringify({ type: 'thread.started', thread_id: 'test' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'internal' } }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"tool_id":"weather.forecast"}' },
        }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
      ].join('\n'),
    ),
    { tool_id: 'weather.forecast' },
  );
  assert.throws(
    () =>
      parseCodexEvents(
        JSON.stringify({
          type: 'item.started',
          item: { type: 'command_execution', command: 'pwd' },
        }),
      ),
    (error) => error.adapterCode === 'tool_use_rejected' && /attempted to use a tool/.test(error.message),
  );
  assert.throws(
    () => parseCodexEvents(JSON.stringify({ type: 'turn.failed', error: { message: 'private' } })),
    (error) => error.adapterCode === 'model_failed' && /unsuccessful result/.test(error.message),
  );
  assert.throws(
    () =>
      parseCodexEvents(
        [
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'not-json' },
          }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'),
      ),
    /no structured output/,
  );
  assert.throws(
    () =>
      parseCodexEvents(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"tool_id":"weather.forecast"}' },
        }),
      ),
    (error) => error.adapterCode === 'invalid_events' && /incomplete event stream/.test(error.message),
  );
});

test('Codex adapter removes QVeris environment values from its model subprocess', async () => {
  const previousKey = process.env.QVERIS_API_KEY;
  const previousToken = process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
  process.env.QVERIS_API_KEY = 'must-not-reach-model';
  process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = 'must-also-not-reach-model';
  try {
    const result = parseCodexEvents(
      await runCodex({
        command: process.execPath,
        args: [
          '-e',
          `const visible = Object.keys(process.env).some((name) => name.startsWith('QVERIS_'));
           process.stdout.write([
             JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({visible})}}),
             JSON.stringify({type:'turn.completed'})
           ].join('\\n'));`,
        ],
        stdin: '',
      }),
    );
    assert.deepEqual(result, { visible: false });
  } finally {
    if (previousKey === undefined) delete process.env.QVERIS_API_KEY;
    else process.env.QVERIS_API_KEY = previousKey;
    if (previousToken === undefined) delete process.env.QVERIS_MCP_HTTP_AUTH_TOKEN;
    else process.env.QVERIS_MCP_HTTP_AUTH_TOKEN = previousToken;
  }
});

test('Codex adapter force-kills a child that ignores the output-limit signal', async () => {
  await assert.rejects(
    runCodex(
      {
        command: process.execPath,
        args: [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)",
        ],
        stdin: '',
      },
      { outputLimit: 10, forceKillAfterMs: 20 },
    ),
    (error) => error.adapterCode === 'output_limit',
  );
});

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  return !processExists(pid);
}
