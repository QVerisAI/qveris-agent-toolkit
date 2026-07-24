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
  let turnCompleted = false;
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
    if (event.type === 'turn.completed') turnCompleted = true;

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
  if (!turnCompleted) {
    throw adapterFailure('Codex CLI returned an incomplete event stream', 'invalid_events');
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

export function runCodex(invocation, { outputLimit = 1_000_000, forceKillAfterMs = 1_000 } = {}) {
  if (!Number.isInteger(outputLimit) || outputLimit < 1) {
    throw new Error('outputLimit must be a positive integer');
  }
  if (!Number.isInteger(forceKillAfterMs) || forceKillAfterMs < 1) {
    throw new Error('forceKillAfterMs must be a positive integer');
  }
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    stripQverisEnvironment(env);
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let output = '';
    let forwardedSignal;
    let forceKillTimer;
    let terminationError;
    let settled = false;

    const cleanup = () => {
      process.off('SIGINT', forwardSigint);
      process.off('SIGTERM', forwardSigterm);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const terminate = (error, signal = 'SIGTERM') => {
      if (terminationError || settled) return;
      terminationError = error;
      child.kill(signal);
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), forceKillAfterMs);
      forceKillTimer.unref();
    };
    const forwardSignal = (signal) => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      const error = adapterFailure('Codex CLI interrupted', 'interrupted');
      error.adapterSignal = signal;
      terminate(error, signal);
    };
    const forwardSigint = () => forwardSignal('SIGINT');
    const forwardSigterm = () => forwardSignal('SIGTERM');
    process.once('SIGINT', forwardSigint);
    process.once('SIGTERM', forwardSigterm);

    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      if (terminationError) return;
      output += chunk;
      if (output.length > outputLimit) {
        terminate(adapterFailure('Codex CLI output exceeded the adapter limit', 'output_limit'));
      }
    });
    child.stderr.resume();
    child.on('error', () => {
      if (terminationError) return;
      cleanup();
      rejectOnce(adapterFailure('Codex CLI could not be started', 'start_failed'));
    });
    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      if (forwardedSignal) {
        return rejectOnce(terminationError);
      }
      if (terminationError) return rejectOnce(terminationError);
      settled = true;
      if (code === 0) resolve(output);
      else reject(adapterFailure('Codex CLI invocation failed', 'cli_failed'));
    });
    child.stdin.end(invocation.stdin);
  });
}

function stripQverisEnvironment(env) {
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('QVERIS_')) delete env[name];
  }
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
    if (error?.adapterSignal) {
      process.kill(process.pid, error.adapterSignal);
      return;
    }
    const code = typeof error?.adapterCode === 'string' ? error.adapterCode : 'invalid_output';
    process.stderr.write(`QVERIS_BENCHMARK_ADAPTER_ERROR=${code}\n`);
    process.exitCode = 1;
  });
}
