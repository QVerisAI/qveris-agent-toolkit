#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiClient } from './api.mjs';
import { runBenchmark } from './harness.mjs';
import { readJsonLines, validatePathSeparation, writeJsonLines } from './io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const tasksPath = resolve(options.tasks);
  const output = resolve(options.output);
  await validatePathSeparation({ inputs: [tasksPath], outputs: [output] });
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
    onRecord: (records) => writeJsonLines(output, records),
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
  stripQverisEnvironment(adapterEnv);
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
      let terminationError;
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
        if (settled || terminationError) return;
        terminationError = error;
        clearTimeout(timer);
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), forceKillAfterMs);
        forceKillTimer.unref();
      };
      const timer = setTimeout(() => {
        terminate(adapterError('Adapter timed out', 'timeout'));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        if (terminationError) return;
        stdout += chunk;
        if (stdout.length > 1_000_000 && !stdoutExceeded) {
          stdoutExceeded = true;
          terminate(adapterError('Adapter output exceeded the limit', 'stdout_limit'));
        }
      });
      child.stderr.on('data', (chunk) => {
        if (terminationError) return;
        stderr += chunk;
        if (stderr.length > 100_000 && !stderrExceeded) {
          stderrExceeded = true;
          terminate(adapterError('Adapter error output exceeded the limit', 'stderr_limit'));
        }
      });
      child.on('error', () => {
        if (terminationError) return;
        cleanup();
        rejectOnce(adapterError('Adapter could not be started', 'start_failed'));
      });
      child.on('close', (code) => {
        cleanup();
        if (settled) return;
        if (terminationError) return rejectOnce(terminationError);
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

function stripQverisEnvironment(env) {
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('QVERIS_')) delete env[name];
  }
}

function parseArgs(argv) {
  const options = {
    output: resolve(process.cwd(), 'benchmark-runs.jsonl'),
    trials: 3,
    execute: false,
    limit: 10,
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
  if (!options.help && !options.tasks) throw new Error('--tasks is required');
  if (!options.help && !options.lane) throw new Error('--lane is required');
  if (!options.help) {
    safeProvenanceValue(options.model, '--model');
    safeProvenanceValue(options.adapterRevision, '--adapter-revision');
    safeProvenanceValue(options.modelRevision, '--model-revision');
  }
  if (!options.help && ['reference', 'pinned-model'].includes(options.lane) && options.modelRevision === 'unreported') {
    throw new Error(`--model-revision is required for --lane ${options.lane}`);
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
  if (!['reference', 'configured-model', 'pinned-model', 'current-model'].includes(value)) {
    throw new Error('--lane must be reference, configured-model, pinned-model, or current-model');
  }
  return value;
}

function safeProvenanceValue(value, flag) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 256 ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new Error(`${flag} must be a safe non-empty string of at most 256 characters`);
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

export function resolveToolkitRevision(
  explicit,
  { githubSha = process.env.GITHUB_SHA, execFile = execFileSync, root = ROOT } = {},
) {
  const declaredRevision = explicit
    ? commitSha(explicit, '--toolkit-revision')
    : githubSha
      ? commitSha(githubSha, 'GITHUB_SHA')
      : null;
  let dirty;
  try {
    dirty = execFile('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    if (declaredRevision) return declaredRevision;
    throw new Error('--toolkit-revision is required outside a clean git checkout');
  }
  if (dirty) {
    throw new Error('Working tree has tracked changes; commit them before running the benchmark');
  }
  let revision;
  try {
    revision = execFile('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('--toolkit-revision is required outside a clean git checkout');
  }
  const headRevision = commitSha(revision, 'git HEAD');
  if (declaredRevision && declaredRevision !== headRevision) {
    throw new Error('Declared toolkit revision does not match the checked-out git HEAD');
  }
  return declaredRevision ?? headRevision;
}

function commitSha(value, source) {
  const revision = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) {
    throw new Error(`${source} must be a 40- or 64-character commit SHA`);
  }
  return revision;
}

function helpText() {
  return `QVeris discover→call benchmark\n\nUsage:\n  node src/run.mjs --model MODEL --lane LANE --tasks PATH --adapter COMMAND --adapter-revision REVISION [options]\n\nOptions:\n  --adapter-arg VALUE       Repeatable adapter argument (no shell parsing)\n  --adapter-revision VALUE  Immutable adapter source/config revision (required)\n  --toolkit-revision VALUE  Toolkit commit SHA (auto-detected only in a clean checkout)\n  --model-revision VALUE    Provider snapshot/backend revision; required for reference and pinned-model\n  --tasks PATH              Immutable task-set JSONL (required)\n  --output PATH             Private run-record JSONL with per-trial checkpoints (default: benchmark-runs.jsonl)\n  --trials N                Trials per task (default: 3)\n  --limit N                 Discover result limit (default: 10)\n  --lane VALUE              reference, configured-model, pinned-model, or current-model (required)\n  --execute                 Perform billed call requests (required for workflow success)\n  --adapter-timeout-ms N    Per-stage adapter timeout (default: 120000)\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
