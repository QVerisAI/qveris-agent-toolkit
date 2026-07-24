#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateTaskSet } from '../benchmarks/discover-call/src/harness.mjs';
import { readReleasePlan } from './release-client-packages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = 'benchmarks/discover-call/cadence.json';
const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_VALUE_RE = /^[0-9A-Za-z@._/+:-]+$/;
const REFERENCE_ADAPTER = 'benchmarks/discover-call/adapters/reference.mjs';
const CONFIGURED_ADAPTER = 'benchmarks/discover-call/adapters/codex-cli.mjs';
const CONFIGURED_CLI_PACKAGE = '@openai/codex';
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'api_key',
  'authorization',
  'connection_id',
  'execution_id',
  'raw_parameters',
  'raw_result',
  'search_id',
  'session_id',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeValue(value, label) {
  if (typeof value !== 'string' || !value || value.length > 256 || !SAFE_VALUE_RE.test(value)) {
    throw new Error(`${label} must be a safe non-empty value`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function exactObjectKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const missing = wanted.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !wanted.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(
      `${label} has invalid fields; missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}`,
    );
  }
}

export function validateCadenceConfig(config, { taskCount } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Cadence config must be an object');
  }
  exactObjectKeys(
    config,
    ['schema_version', 'task_set', 'task_version', 'trials', 'discovery_limit', 'reference', 'configured_model'],
    'Cadence config',
  );
  if (config.schema_version !== 1) throw new Error('Cadence config schema_version must be 1');
  safeValue(config.task_set, 'task_set');
  if (!/^benchmarks\/discover-call\/tasks\/v\d+\.jsonl$/.test(config.task_set)) {
    throw new Error('task_set must select a versioned discover-call task file');
  }
  if (!/^v\d+$/.test(config.task_version) || !config.task_set.endsWith(`/${config.task_version}.jsonl`)) {
    throw new Error('task_version must match task_set');
  }
  positiveInteger(config.trials, 'trials');
  if (config.trials < 3) throw new Error('trials must be at least 3 for an official cadence run');
  if (config.trials > 100) throw new Error('trials must not exceed the benchmark runner limit of 100');
  positiveInteger(config.discovery_limit, 'discovery_limit');
  if (config.discovery_limit > 100) {
    throw new Error('discovery_limit must not exceed the benchmark runner limit of 100');
  }

  for (const [label, lane] of [
    ['reference', config.reference],
    ['configured_model', config.configured_model],
  ]) {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) throw new Error(`${label} must be an object`);
    exactObjectKeys(
      lane,
      label === 'reference'
        ? ['model', 'model_revision', 'adapter']
        : ['model', 'model_revision', 'adapter', 'cli_package', 'cli_version', 'reasoning_effort'],
      label,
    );
    safeValue(lane.model, `${label}.model`);
    safeValue(lane.model_revision, `${label}.model_revision`);
    safeValue(lane.adapter, `${label}.adapter`);
  }

  if (config.reference.model !== 'reference-v1' || config.reference.model_revision !== 'deterministic-reference-v1') {
    throw new Error('reference model identity must match the deterministic reference adapter');
  }
  if (config.reference.adapter !== REFERENCE_ADAPTER) {
    throw new Error(`reference.adapter must be ${REFERENCE_ADAPTER}`);
  }
  if (config.configured_model.adapter !== CONFIGURED_ADAPTER) {
    throw new Error(`configured_model.adapter must be ${CONFIGURED_ADAPTER}`);
  }
  safeValue(config.configured_model.cli_package, 'configured_model.cli_package');
  if (config.configured_model.cli_package !== CONFIGURED_CLI_PACKAGE) {
    throw new Error(`configured_model.cli_package must be ${CONFIGURED_CLI_PACKAGE}`);
  }
  if (!VERSION_RE.test(config.configured_model.cli_version)) {
    throw new Error('configured_model.cli_version must be an exact semantic version');
  }
  if (config.configured_model.reasoning_effort !== 'medium') {
    throw new Error("configured_model.reasoning_effort must match the adapter's fixed medium setting");
  }

  if (taskCount !== undefined) {
    positiveInteger(taskCount, 'taskCount');
    return {
      recordsPerLane: taskCount * config.trials,
      maximumBilledCalls: taskCount * config.trials * 2,
    };
  }
  return null;
}

export function cadenceRunDisposition(prs, { branchExists = false } = {}) {
  if (!Array.isArray(prs)) throw new Error('Cadence PR lookup must return an array');
  if (typeof branchExists !== 'boolean') throw new Error('Cadence branch existence must be a boolean');
  if (prs.length > 1) throw new Error('Multiple cadence PRs exist for the same release branch');
  if (prs.length === 1) {
    const pr = prs[0];
    const state = pr?.mergedAt ? 'MERGED' : String(pr?.state || '').toUpperCase();
    const url = typeof pr?.url === 'string' && pr.url ? pr.url : '(unknown PR)';
    if (state === 'OPEN' || state === 'MERGED') {
      return {
        skip: true,
        message: `Cadence already represented by ${url} (${state}); no paid rerun will start.`,
      };
    }
    throw new Error(`A closed, unmerged cadence PR already exists: ${url}`);
  }
  if (branchExists) {
    throw new Error(
      'A cadence result branch exists without a PR; recover that branch into a draft PR before any paid rerun',
    );
  }
  return { skip: false, message: 'No prior cadence result exists; the protected paid job may proceed.' };
}

export function buildCadencePlan({
  config,
  releases,
  releaseSha,
  taskCount,
  tagCommit,
  runDate = new Date().toISOString().slice(0, 10),
}) {
  if (!SHA_RE.test(releaseSha)) throw new Error('release_sha must be a lowercase 40-character commit SHA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error('runDate must be YYYY-MM-DD');
  const limits = validateCadenceConfig(config, { taskCount });
  if (!Array.isArray(releases) || releases.length !== 4) {
    throw new Error('Cadence requires the four coordinated client releases');
  }

  for (const release of releases) {
    const commit = tagCommit(release.tag);
    if (commit !== releaseSha) {
      throw new Error(`${release.tag} points to ${commit || 'missing'}, not release_sha ${releaseSha}`);
    }
  }

  const shortSha = releaseSha.slice(0, 12);
  const safeModel = config.configured_model.model.replace(/[^0-9A-Za-z.-]+/g, '-');
  const suffix = `release-${shortSha}-${config.task_version}`;
  return {
    releaseSha,
    shortSha,
    branch: `benchmark/cadence-${shortSha}`,
    releaseTags: releases.map((release) => release.tag),
    taskSet: config.task_set,
    taskVersion: config.task_version,
    trials: config.trials,
    discoveryLimit: config.discovery_limit,
    recordsPerLane: limits.recordsPerLane,
    maximumBilledCalls: limits.maximumBilledCalls,
    reference: config.reference,
    configuredModel: config.configured_model,
    referenceStem: `${runDate}-${config.reference.model}-${suffix}`,
    configuredStem: `${runDate}-${safeModel}-configured-${suffix}`,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function ratio(value, total) {
  return `${value}/${total}`;
}

function modelSummary(summary, label) {
  if (!summary || !Array.isArray(summary.models) || summary.models.length !== 1) {
    throw new Error(`${label} summary must contain exactly one model`);
  }
  return summary.models[0];
}

function metadata(summary, label) {
  const value = summary?.records?.[0]?.metadata;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} summary is missing record metadata`);
  }
  return value;
}

function validateSummaryForPlan(summary, plan, lane) {
  const label = lane === 'reference' ? 'Reference' : 'Configured-model';
  const model = modelSummary(summary, label);
  const recordMetadata = metadata(summary, label);
  const expected = lane === 'reference' ? plan.reference : plan.configuredModel;
  const expectedAdapterRevision =
    lane === 'reference'
      ? `${plan.releaseSha}/reference-v1`
      : `${plan.releaseSha}/codex-cli-${plan.configuredModel.cli_version}/${plan.configuredModel.reasoning_effort}`;

  if (summary.methodology !== 'discover-call-v2') throw new Error(`${label} summary must use discover-call-v2`);
  if (model.lane !== lane || model.model !== expected.model) {
    throw new Error(`${label} summary does not match the cadence lane and model`);
  }
  if (model.runs !== plan.recordsPerLane || model.trials_per_task !== plan.trials) {
    throw new Error(`${label} summary does not match the cadence denominator`);
  }
  if (!Array.isArray(summary.records) || summary.records.length !== plan.recordsPerLane) {
    throw new Error(`${label} summary must contain every public run record`);
  }
  if (
    recordMetadata.toolkit_revision !== plan.releaseSha ||
    recordMetadata.model_revision !== expected.model_revision ||
    recordMetadata.adapter_revision !== expectedAdapterRevision ||
    recordMetadata.discovery_limit !== plan.discoveryLimit ||
    recordMetadata.execute !== true
  ) {
    throw new Error(`${label} summary provenance does not match the immutable cadence plan`);
  }
}

export function buildResultSection({ referenceSummary, configuredSummary, plan, generatedAt }) {
  validateSummaryForPlan(referenceSummary, plan, 'reference');
  validateSummaryForPlan(configuredSummary, plan, 'configured-model');
  const reference = modelSummary(referenceSummary, 'Reference');
  const configured = modelSummary(configuredSummary, 'Configured-model');
  const referenceMetadata = metadata(referenceSummary, 'Reference');
  const configuredMetadata = metadata(configuredSummary, 'Configured-model');
  const gap = reference.workflow_success_rate - configured.workflow_success_rate;
  const generatedDate = generatedAt.slice(0, 10);
  const referenceCallSuccesses = Math.round(reference.call_success_rate * reference.executed);
  const configuredCallSuccesses = Math.round(configured.call_success_rate * configured.executed);
  const referenceNonempty = Math.round(reference.result_nonempty_rate * referenceCallSuccesses);
  const configuredNonempty = Math.round(configured.result_nonempty_rate * configuredCallSuccesses);

  return `<!-- benchmark-cadence:${plan.releaseSha} -->
## ${generatedDate} — coordinated release \`${plan.shortSha}\`

This draft baseline was generated by the protected per-release cadence for
${plan.releaseTags.map((tag) => `\`${tag}\``).join(', ')}. It uses immutable
\`${plan.taskSet.replace('benchmarks/discover-call/', '')}\`, ${reference.tasks} tasks,
${reference.trials_per_task} trials per task, Top ${referenceMetadata.discovery_limit}
discovery, and real calls. Failed trials remain in the denominator.

| Metric | Curated reference route | \`${configured.model}\` configured model |
| --- | ---: | ---: |
| Runs | ${reference.runs} | ${configured.runs} |
| Completed and executed | ${ratio(reference.executed, reference.runs)} | ${ratio(configured.executed, configured.runs)} |
| Selection grounded | ${percent(reference.selection_grounded_rate)} | ${percent(configured.selection_grounded_rate)} |
| Inspection grounded | ${percent(reference.inspection_grounded_rate)} | ${percent(configured.inspection_grounded_rate)} |
| Required-parameter accuracy | ${percent(reference.required_parameter_accuracy)} | ${percent(configured.required_parameter_accuracy)} |
| Constraint accuracy | ${percent(reference.constraint_accuracy)} | ${percent(configured.constraint_accuracy)} |
| Call success among attempted calls | ${percent(reference.call_success_rate)} (${ratio(referenceCallSuccesses, reference.executed)}) | ${percent(configured.call_success_rate)} (${ratio(configuredCallSuccesses, configured.executed)}) |
| Result non-empty among successful calls | ${percent(reference.result_nonempty_rate)} (${ratio(referenceNonempty, referenceCallSuccesses)}) | ${percent(configured.result_nonempty_rate)} (${ratio(configuredNonempty, configuredCallSuccesses)}) |
| Strict workflow success | ${percent(reference.workflow_success_rate)} (${ratio(Math.round(reference.workflow_success_rate * reference.runs), reference.runs)}) | ${percent(configured.workflow_success_rate)} (${ratio(Math.round(configured.workflow_success_rate * configured.runs), configured.runs)}) |
| Task-cluster bootstrap 95% interval | ${reference.workflow_success_task_cluster_bootstrap_95.map(percent).join('–')} | ${configured.workflow_success_task_cluster_bootstrap_95.map(percent).join('–')} |

The strict benchmark gap is **${ratio(Math.round(gap * reference.runs), reference.runs)} =
${(gap * 100).toFixed(2)} percentage points**. This is an end-to-end benchmark
difference, not automatically a pure routing effect. The lanes observed catalog
digests \`${referenceMetadata.catalog_observation_sha256}\` and
\`${configuredMetadata.catalog_observation_sha256}\`; reviewers must confirm
whether the API and catalog revisions support any stronger comparison claim.
The configured provider model revision is
\`${configuredMetadata.model_revision}\`, so a value of \`unreported\` must not
be described as a pinned-model snapshot.

Artifacts:

- \`${plan.referenceStem}.runs.jsonl\`
- \`${plan.referenceStem}.summary.json\`
- \`${plan.configuredStem}.runs.jsonl\`
- \`${plan.configuredStem}.summary.json\`
`;
}

export function insertResultSection(readme, section, releaseSha) {
  const marker = `<!-- benchmark-cadence:${releaseSha} -->`;
  if (readme.includes(marker)) throw new Error(`README already contains cadence result ${releaseSha}`);
  const heading = '# Published benchmark results\n';
  if (!readme.startsWith(heading)) throw new Error('Results README is missing its expected heading');
  return `${heading}\n${section.trim()}\n\n${readme.slice(heading.length).trimStart()}`;
}

function visitPublicValue(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPublicValue(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key.toLowerCase())) {
      throw new Error(`Forbidden public field ${path}.${key}`);
    }
    visitPublicValue(child, `${path}.${key}`);
  }
}

export function assertPublicArtifactSafe(value) {
  visitPublicValue(value);
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error.stderr || error.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function gitSucceeds(args) {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function parseTaskSet(text, path = '<task-set>') {
  const tasks = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      tasks.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`);
    }
  }
  return validateTaskSet(tasks);
}

function readTaskSet(path) {
  return parseTaskSet(readFileSync(path, 'utf8'), path);
}

function writeGithubOutput(path, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}\n`);
  writeFileSync(path, lines.join(''), { encoding: 'utf8', flag: 'a' });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith('--')) throw new Error(`Unknown argument: ${flag}`);
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = value;
  }
  return { command, options };
}

function loadPlan(releaseSha) {
  const config = readJson(resolve(ROOT, CONFIG_PATH));
  const releases = readReleasePlan(ROOT);
  const taskPath = resolve(ROOT, config.task_set);
  return buildCadencePlan({
    config,
    releases,
    releaseSha,
    taskCount: readTaskSet(taskPath).length,
    tagCommit: (tag) => {
      if (git(['cat-file', '-t', `refs/tags/${tag}`], { allowFailure: true }) !== 'tag') return null;
      return git(['rev-parse', `refs/tags/${tag}^{}`], { allowFailure: true });
    },
  });
}

function planCommand(options) {
  if (!options.releaseSha) throw new Error('--release-sha is required');
  if (!options.githubOutput) throw new Error('--github-output is required');
  if (!SHA_RE.test(options.releaseSha)) throw new Error('--release-sha must be a lowercase 40-character commit SHA');
  if (!gitSucceeds(['merge-base', '--is-ancestor', options.releaseSha, 'origin/main'])) {
    throw new Error('release_sha must be reachable from origin/main');
  }
  const plan = loadPlan(options.releaseSha);
  const benchmarkRoot = resolve(ROOT, 'benchmarks/discover-call');
  writeGithubOutput(options.githubOutput, {
    release_sha: plan.releaseSha,
    release_short_sha: plan.shortSha,
    branch: plan.branch,
    release_tags: plan.releaseTags.join(','),
    task_set: relative(resolve(ROOT, 'benchmarks/discover-call'), resolve(ROOT, plan.taskSet)),
    task_version: plan.taskVersion,
    trials: plan.trials,
    discovery_limit: plan.discoveryLimit,
    records_per_lane: plan.recordsPerLane,
    maximum_billed_calls: plan.maximumBilledCalls,
    reference_model: plan.reference.model,
    reference_model_revision: plan.reference.model_revision,
    reference_adapter: relative(benchmarkRoot, resolve(ROOT, plan.reference.adapter)),
    configured_model: plan.configuredModel.model,
    configured_model_revision: plan.configuredModel.model_revision,
    configured_adapter: relative(benchmarkRoot, resolve(ROOT, plan.configuredModel.adapter)),
    cli_package: plan.configuredModel.cli_package,
    cli_version: plan.configuredModel.cli_version,
    reasoning_effort: plan.configuredModel.reasoning_effort,
    reference_stem: plan.referenceStem,
    configured_stem: plan.configuredStem,
  });
}

function guardCommand(options) {
  if (!options.prsJson) throw new Error('--prs-json is required');
  if (!options.branchExists) throw new Error('--branch-exists is required');
  if (!options.githubOutput) throw new Error('--github-output is required');
  if (!['true', 'false'].includes(options.branchExists)) {
    throw new Error('--branch-exists must be true or false');
  }
  let prs;
  try {
    prs = JSON.parse(options.prsJson);
  } catch (error) {
    throw new Error(`--prs-json must be valid JSON: ${error.message}`);
  }
  const disposition = cadenceRunDisposition(prs, { branchExists: options.branchExists === 'true' });
  process.stdout.write(`${disposition.message}\n`);
  writeGithubOutput(options.githubOutput, { skip: disposition.skip });
}

function documentCommand(options) {
  for (const key of [
    'releaseSha',
    'referenceSummary',
    'configuredSummary',
    'referenceRuns',
    'configuredRuns',
    'readme',
    'prBody',
  ]) {
    if (!options[key])
      throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  const plan = loadPlan(options.releaseSha);
  for (const [path, expected] of [
    [options.referenceRuns, `${plan.referenceStem}.runs.jsonl`],
    [options.referenceSummary, `${plan.referenceStem}.summary.json`],
    [options.configuredRuns, `${plan.configuredStem}.runs.jsonl`],
    [options.configuredSummary, `${plan.configuredStem}.summary.json`],
  ]) {
    if (basename(path) !== expected) throw new Error(`${path} must use cadence artifact name ${expected}`);
  }
  const referenceSummary = readJson(resolve(options.referenceSummary));
  const configuredSummary = readJson(resolve(options.configuredSummary));
  for (const path of [
    options.referenceRuns,
    options.configuredRuns,
    options.referenceSummary,
    options.configuredSummary,
  ]) {
    const content = readFileSync(resolve(path), 'utf8');
    if (path.endsWith('.jsonl')) {
      content
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => assertPublicArtifactSafe(JSON.parse(line)));
    } else {
      assertPublicArtifactSafe(JSON.parse(content));
    }
  }
  const generatedAt = new Date().toISOString();
  const section = buildResultSection({ referenceSummary, configuredSummary, plan, generatedAt });
  const readmePath = resolve(options.readme);
  writeFileSync(readmePath, insertResultSection(readFileSync(readmePath, 'utf8'), section, options.releaseSha), 'utf8');
  writeFileSync(
    resolve(options.prBody),
    `## What changed

- runs the protected per-release discover → inspect → call cadence for ${plan.releaseTags.map((tag) => `\`${tag}\``).join(', ')}
- publishes only sanitized public runs and generated summaries; raw operational records remain outside the repository
- records release commit \`${plan.releaseSha}\`, immutable task/model/adapter configuration, API/catalog provenance, and complete failure denominators

${section}

## Review checklist

- [ ] Confirm the configured model and provider revision wording.
- [ ] Review every failure class and the catalog-observation comparison.
- [ ] Align the English and Chinese benchmark overview pages if this candidate becomes the new headline baseline.
- [ ] Confirm no selective reruns were performed.

## Validation

- [x] Official-publication validator
- [x] Public artifact forbidden-field scan
- [x] Benchmark harness tests

Closes no issue automatically. The draft must receive normal code and methodology review before it is marked ready.
`,
    'utf8',
  );
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'plan') planCommand(options);
  else if (command === 'guard') guardCommand(options);
  else if (command === 'document') documentCommand(options);
  else throw new Error(`Unknown command: ${command || '(missing)'}`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
