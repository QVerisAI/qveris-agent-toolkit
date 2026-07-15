#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiClient } from './api.mjs';
import { runBenchmark } from './harness.mjs';
import { readJsonLines, writeJsonLines } from './io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const tasksPath = resolve(options.tasks);
  const tasks = await readJsonLines(tasksPath);
  const taskSetSha256 = createHash('sha256')
    .update(await readFile(tasksPath))
    .digest('hex');
  const toolkitRevision = resolveToolkitRevision(options.toolkitRevision);
  const api = createApiClient({ apiKey: process.env.QVERIS_API_KEY, baseUrl: process.env.QVERIS_BASE_URL });
  const invokeAdapter = createProcessAdapter({
    command: options.adapter,
    args: options.adapterArgs,
    timeoutMs: options.adapterTimeoutMs,
  });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const records = await runBenchmark({
    tasks,
    model: options.model,
    trials: options.trials,
    execute: options.execute,
    limit: options.limit,
    api,
    invokeAdapter,
    metadata: {
      adapter_revision: options.adapterRevision,
      toolkit_revision: toolkitRevision,
      task_set_sha256: taskSetSha256,
      api_base_url: api.baseUrl,
      discovery_limit: options.limit,
      execute: options.execute,
    },
  });
  await writeJsonLines(output, records);
  process.stdout.write(`Wrote ${records.length} benchmark records to ${output}\n`);
}

export function createProcessAdapter({ command, args = [], timeoutMs = 120_000 }) {
  if (typeof command !== 'string' || !command) throw new Error('--adapter is required');
  const adapterEnv = { ...process.env };
  delete adapterEnv.QVERIS_API_KEY;
  return (payload) =>
    new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: adapterEnv,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(adapterError('Adapter timed out'));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 1_000_000) child.kill('SIGTERM');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 100_000) child.kill('SIGTERM');
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(adapterError('Adapter could not be started'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(adapterError('Adapter exited unsuccessfully'));
        try {
          resolvePromise(JSON.parse(stdout.trim()));
        } catch {
          reject(adapterError('Adapter returned invalid JSON'));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    });
}

function parseArgs(argv) {
  const options = {
    tasks: resolve(ROOT, 'tasks/v1.jsonl'),
    output: resolve(process.cwd(), 'benchmark-runs.jsonl'),
    trials: 3,
    execute: false,
    limit: 10,
    adapterArgs: [],
    adapterTimeoutMs: 120_000,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--adapter-arg') options.adapterArgs.push(nextValue(argv, ++index, arg));
    else if (arg === '--adapter') options.adapter = nextValue(argv, ++index, arg);
    else if (arg === '--adapter-revision') options.adapterRevision = nextValue(argv, ++index, arg);
    else if (arg === '--toolkit-revision') options.toolkitRevision = nextValue(argv, ++index, arg);
    else if (arg === '--model') options.model = nextValue(argv, ++index, arg);
    else if (arg === '--tasks') options.tasks = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--trials') options.trials = integer(nextValue(argv, ++index, arg), arg);
    else if (arg === '--limit') options.limit = integer(nextValue(argv, ++index, arg), arg);
    else if (arg === '--adapter-timeout-ms') options.adapterTimeoutMs = integer(nextValue(argv, ++index, arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.model) throw new Error('--model is required');
  if (!options.help && !options.adapter) throw new Error('--adapter is required');
  if (!options.help && !options.adapterRevision) throw new Error('--adapter-revision is required');
  return options;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function integer(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} requires a positive integer`);
  return parsed;
}

function adapterError(message) {
  const error = new Error(message);
  error.benchmarkStage = 'adapter';
  return error;
}

function resolveToolkitRevision(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('--toolkit-revision is required outside a git checkout');
  }
}

function helpText() {
  return `QVeris discover→call benchmark\n\nUsage:\n  node src/run.mjs --model MODEL --adapter COMMAND --adapter-revision REVISION [options]\n\nOptions:\n  --adapter-arg VALUE       Repeatable adapter argument (no shell parsing)\n  --adapter-revision VALUE  Immutable adapter source/config revision (required)\n  --toolkit-revision VALUE  Toolkit revision (auto-detected in git/GitHub Actions)\n  --tasks PATH              Task-set JSONL (default: tasks/v1.jsonl)\n  --output PATH             Run-record JSONL (default: benchmark-runs.jsonl)\n  --trials N                Trials per task (default: 3)\n  --limit N                 Discover result limit (default: 10)\n  --execute                 Perform billed call requests (required for workflow success)\n  --adapter-timeout-ms N    Per-stage adapter timeout (default: 120000)\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
