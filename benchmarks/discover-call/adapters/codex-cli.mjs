#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODEX_REASONING_EFFORT = 'medium';

const ALLOWED_ITEM_TYPES = new Set(['agent_message', 'reasoning']);

export function buildCodexInvocation(payload, { schemaPath, workingDirectory }) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid adapter payload');
  if (typeof payload.model !== 'string' || !payload.model.trim()) throw new Error('Missing model');
  if (!Array.isArray(payload.messages) || payload.messages.length !== 2) {
    throw new Error('Expected exactly two canonical messages');
  }
  const [systemMessage, userMessage] = payload.messages;
  if (systemMessage?.role !== 'system' || typeof systemMessage.content !== 'string') {
    throw new Error('Missing canonical system message');
  }
  if (userMessage?.role !== 'user' || typeof userMessage.content !== 'string') {
    throw new Error('Missing canonical user message');
  }
  if (!isObject(payload.response_schema)) throw new Error('Missing response schema');
  if (typeof schemaPath !== 'string' || !schemaPath) throw new Error('Missing schema path');
  if (typeof workingDirectory !== 'string' || !workingDirectory) {
    throw new Error('Missing working directory');
  }

  return {
    command: process.env.CODEX_BIN || 'codex',
    args: [
      'exec',
      '--model',
      payload.model,
      '--config',
      `developer_instructions=${JSON.stringify(systemMessage.content)}`,
      '--config',
      `model_reasoning_effort=${JSON.stringify(CODEX_REASONING_EFFORT)}`,
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--strict-config',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--cd',
      workingDirectory,
      '--output-schema',
      schemaPath,
      '--color',
      'never',
      '--json',
      '-',
    ],
    schema: payload.response_schema,
    stdin: userMessage.content,
  };
}

export function parseCodexEvents(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw adapterFailure('Codex CLI returned no events', 'invalid_events');

  let finalMessage;
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw adapterFailure('Codex CLI returned invalid JSONL', 'invalid_events');
    }
    if (!isObject(event)) throw adapterFailure('Codex CLI returned an invalid event', 'invalid_events');
    if (event.type === 'error' || event.type === 'turn.failed') {
      throw adapterFailure('Codex CLI reported an unsuccessful result', 'model_failed');
    }

    if ((event.type === 'item.started' || event.type === 'item.completed') && isObject(event.item)) {
      if (!ALLOWED_ITEM_TYPES.has(event.item.type)) {
        throw adapterFailure('Codex CLI attempted to use a tool', 'tool_use_rejected');
      }
      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        if (typeof event.item.text !== 'string') {
          throw adapterFailure('Codex CLI returned an invalid agent message', 'invalid_output');
        }
        finalMessage = event.item.text;
      }
    }
  }

  if (typeof finalMessage !== 'string') {
    throw adapterFailure('Codex CLI returned no structured output', 'invalid_output');
  }
  try {
    const result = JSON.parse(finalMessage);
    if (isObject(result)) return result;
  } catch {
    // Fall through to the generic, non-sensitive error below.
  }
  throw adapterFailure('Codex CLI returned no structured output', 'invalid_output');
}

export async function invokeCodex(payload) {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'qveris-codex-adapter-'));
  const schemaPath = join(workingDirectory, 'response-schema.json');
  try {
    const invocation = buildCodexInvocation(payload, { schemaPath, workingDirectory });
    await writeFile(schemaPath, JSON.stringify(invocation.schema), { encoding: 'utf8', mode: 0o600 });
    const stdout = await runCodex(invocation);
    return parseCodexEvents(stdout);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function runCodex(invocation) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.QVERIS_API_KEY;
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let output = '';
    let outputExceeded = false;
    let forwardedSignal;
    let forceKillTimer;

    const cleanup = () => {
      process.off('SIGINT', forwardSigint);
      process.off('SIGTERM', forwardSigterm);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const forwardSignal = (signal) => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      child.kill(signal);
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      forceKillTimer.unref();
    };
    const forwardSigint = () => forwardSignal('SIGINT');
    const forwardSigterm = () => forwardSignal('SIGTERM');
    process.once('SIGINT', forwardSigint);
    process.once('SIGTERM', forwardSigterm);

    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1_000_000 && !outputExceeded) {
        outputExceeded = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.resume();
    child.on('error', () => {
      cleanup();
      reject(adapterFailure('Codex CLI could not be started', 'start_failed'));
    });
    child.on('close', (code) => {
      cleanup();
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal);
        return;
      }
      if (outputExceeded) {
        return reject(adapterFailure('Codex CLI output exceeded the adapter limit', 'output_limit'));
      }
      if (code === 0) resolve(output);
      else reject(adapterFailure('Codex CLI invocation failed', 'cli_failed'));
    });
    child.stdin.end(invocation.stdin);
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function adapterFailure(message, code) {
  const error = new Error(message);
  error.adapterCode = code;
  return error;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const result = await invokeCodex(JSON.parse(input));
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = typeof error?.adapterCode === 'string' ? error.adapterCode : 'invalid_output';
    process.stderr.write(`QVERIS_BENCHMARK_ADAPTER_ERROR=${code}\n`);
    process.exitCode = 1;
  });
}
