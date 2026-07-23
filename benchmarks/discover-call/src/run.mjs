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
  const metadata = {
    lane: options.lane,
    model_revision: options.modelRevision,
    adapter_revision: options.adapterRevision,
    toolkit_revision: toolkitRevision,
    task_set_sha256: taskSetSha256,
    api_base_url: api.baseUrl,
    api_revision: 'pending',
    catalog_revision: 'pending',
    catalog_observation_sha256: 'pending',
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    discovery_limit: options.limit,
    execute: options.execute,
  };
  const records = await runBenchmark({
    tasks,
    model: options.model,
    trials: options.trials,
    execute: options.execute,
    limit: options.limit,
    api,
    invokeAdapter,
    metadata,
  });
  Object.assign(metadata, api.observedRevisions?.() ?? { api_revision: 'unreported', catalog_revision: 'unreported' });
  metadata.catalog_observation_sha256 = catalogObservationSha256(records);
  await writeJsonLines(output, records);
  process.stdout.write(`Wrote ${records.length} benchmark records to ${output}\n`);
}

export function createProcessAdapter({ command, args = [], timeoutMs = 120_000, forceKillAfterMs = 1_000 }) {
  if (typeof command !== 'string' || !command) throw new Error('--adapter is required');
  if (!Number.isInteger(forceKillAfterMs) || forceKillAfterMs < 1 || forceKillAfterMs > 10_000) {
    throw new Error('forceKillAfterMs must be an integer from 1 to 10000');
  }
  const adapterEnv = { ...process.env };
  delete adapterEnv.QVERIS_API_KEY;
  return (payload) =>
    new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: adapterEnv,
      });
      child.stdin.on('error', () => {});
      let stdout = '';
      let stderr = '';
      let stdoutExceeded = false;
      let stderrExceeded = false;
      let settled = false;
      let forceKillTimer;
      const cleanup = () => {
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const terminate = (error) => {
        if (settled) return;
        clearTimeout(timer);
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), forceKillAfterMs);
        forceKillTimer.unref();
        rejectOnce(error);
      };
      const timer = setTimeout(() => {
        terminate(adapterError('Adapter timed out', 'timeout'));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 1_000_000 && !stdoutExceeded) {
          stdoutExceeded = true;
          terminate(adapterError('Adapter output exceeded the limit', 'stdout_limit'));
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 100_000 && !stderrExceeded) {
          stderrExceeded = true;
          terminate(adapterError('Adapter error output exceeded the limit', 'stderr_limit'));
        }
      });
      child.on('error', () => {
        cleanup();
        rejectOnce(adapterError('Adapter could not be started', 'start_failed'));
      });
      child.on('close', (code) => {
        cleanup();
        if (settled) return;
        settled = true;
        if (code !== 0) {
          return reject(
            adapterError('Adapter exited unsuccessfully', adapterReasonFromStderr(stderr) || 'process_exit'),
          );
        }
        try {
          resolvePromise(JSON.parse(stdout.trim()));
        } catch {
          reject(adapterError('Adapter returned invalid JSON', 'invalid_json'));
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
    lane: 'model',
    modelRevision: 'unreported',
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
    else if (arg === '--model-revision') options.modelRevision = nextValue(argv, ++index, arg);
    else if (arg === '--tasks') options.tasks = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--trials') options.trials = integer(nextValue(argv, ++index, arg), arg);
    else if (arg === '--limit') options.limit = integer(nextValue(argv, ++index, arg), arg);
    else if (arg === '--lane') options.lane = lane(nextValue(argv, ++index, arg));
    else if (arg === '--adapter-timeout-ms') options.adapterTimeoutMs = integer(nextValue(argv, ++index, arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.model) throw new Error('--model is required');
  if (!options.help && !options.adapter) throw new Error('--adapter is required');
  if (!options.help && !options.adapterRevision) throw new Error('--adapter-revision is required');
  if (!options.help && options.lane === 'pinned-model' && options.modelRevision === 'unreported') {
    throw new Error('--model-revision is required for --lane pinned-model');
  }
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

function lane(value) {
  if (!['model', 'oracle', 'reference', 'configured-model', 'pinned-model', 'current-model'].includes(value)) {
    throw new Error('--lane must be model, oracle, reference, configured-model, pinned-model, or current-model');
  }
  return value;
}

function catalogObservationSha256(records) {
  const observation = records.map((record) => ({
    task_id: record.task_id,
    trial: record.trial,
    result_tool_ids: record.discovery?.result_tool_ids ?? [],
  }));
  return createHash('sha256').update(JSON.stringify(observation)).digest('hex');
}

function adapterError(message, reason) {
  const error = new Error(message);
  error.benchmarkStage = 'adapter';
  error.benchmarkReason = reason;
  return error;
}

function adapterReasonFromStderr(stderr) {
  const match = stderr.match(
    /QVERIS_BENCHMARK_ADAPTER_ERROR=(tool_use_rejected|model_failed|invalid_events|invalid_output|cli_failed|start_failed|output_limit|missing_reference|missing_reference_candidate|missing_oracle|missing_oracle_candidate|task_set_mismatch|unsupported_stage)/,
  );
  return match?.[1] ?? null;
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
  return `QVeris discover→call benchmark\n\nUsage:\n  node src/run.mjs --model MODEL --adapter COMMAND --adapter-revision REVISION [options]\n\nOptions:\n  --adapter-arg VALUE       Repeatable adapter argument (no shell parsing)\n  --adapter-revision VALUE  Immutable adapter source/config revision (required)\n  --toolkit-revision VALUE  Toolkit revision (auto-detected in git/GitHub Actions)\n  --model-revision VALUE    Provider snapshot/backend revision; required for pinned-model\n  --tasks PATH              Task-set JSONL (default: tasks/v1.jsonl)\n  --output PATH             Run-record JSONL (default: benchmark-runs.jsonl)\n  --trials N                Trials per task (default: 3)\n  --limit N                 Discover result limit (default: 10)\n  --lane VALUE              reference, configured-model, pinned-model, current-model, or legacy value\n  --execute                 Perform billed call requests (required for workflow success)\n  --adapter-timeout-ms N    Per-stage adapter timeout (default: 120000)\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
