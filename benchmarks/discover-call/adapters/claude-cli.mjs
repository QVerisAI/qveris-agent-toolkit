#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function buildClaudeInvocation(payload) {
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
  if (!payload.response_schema || typeof payload.response_schema !== 'object') {
    throw new Error('Missing response schema');
  }

  return {
    command: process.env.CLAUDE_BIN || 'claude',
    args: [
      '--print',
      '--model',
      payload.model,
      '--system-prompt',
      systemMessage.content,
      '--json-schema',
      JSON.stringify(payload.response_schema),
      '--output-format',
      'json',
      '--tools',
      '',
      '--safe-mode',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
    ],
    stdin: userMessage.content,
  };
}

export function parseClaudeEnvelope(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Claude CLI returned invalid JSON');
  }

  if (!isObject(envelope)) throw new Error('Claude CLI returned an invalid result envelope');
  if (envelope.is_error === true || (typeof envelope.subtype === 'string' && envelope.subtype.startsWith('error'))) {
    throw new Error('Claude CLI reported an unsuccessful result');
  }

  if (isObject(envelope.structured_output)) return envelope.structured_output;
  if (isObject(envelope.structuredOutput)) return envelope.structuredOutput;
  if (typeof envelope.result === 'string') {
    try {
      const result = JSON.parse(envelope.result);
      if (isObject(result)) return result;
    } catch {
      // Fall through to the generic, non-sensitive error below.
    }
  }
  throw new Error('Claude CLI returned no structured output');
}

export async function invokeClaude(payload) {
  const invocation = buildClaudeInvocation(payload);
  return parseClaudeEnvelope(await runClaude(invocation));
}

export function runClaude(invocation, { outputLimit = 1_000_000, forceKillAfterMs = 1_000 } = {}) {
  if (!Number.isInteger(outputLimit) || outputLimit < 1) {
    throw new Error('outputLimit must be a positive integer');
  }
  if (!Number.isInteger(forceKillAfterMs) || forceKillAfterMs < 1) {
    throw new Error('forceKillAfterMs must be a positive integer');
  }
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.QVERIS_API_KEY;
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
      terminate(new Error('Claude CLI interrupted'), signal);
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
        terminate(new Error('Claude CLI output exceeded the adapter limit'));
      }
    });
    child.stderr.resume();
    child.on('error', () => {
      if (terminationError) return;
      cleanup();
      rejectOnce(new Error('Claude CLI could not be started'));
    });
    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal);
        return;
      }
      if (terminationError) return rejectOnce(terminationError);
      settled = true;
      if (code === 0) resolve(output);
      else reject(new Error('Claude CLI invocation failed'));
    });
    child.stdin.end(invocation.stdin);
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const result = await invokeClaude(JSON.parse(input));
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
