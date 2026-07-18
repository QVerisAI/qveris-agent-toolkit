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
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let output = '';
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1_000_000) child.kill('SIGTERM');
    });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Claude CLI could not be started')));
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error('Claude CLI invocation failed'));
    });
    child.stdin.end(invocation.stdin);
  });
  return parseClaudeEnvelope(stdout);
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
