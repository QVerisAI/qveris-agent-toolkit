import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { validateTaskSet } from './harness.mjs';
import { readJsonLines } from './io.mjs';
import { validateOfficialPublicRun, validatePolicy, validatePublicRecords } from './publication.mjs';
import { scoreRecords } from './scoring.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Validate every versioned task set; published results name the exact file.
const taskFiles = (await readdir(resolve(root, 'tasks')))
  .filter((name) => /^v\d+\.jsonl$/.test(name))
  .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10));
if (taskFiles.length === 0) throw new Error('No versioned task sets found under tasks/');

const counts = [];
for (const file of taskFiles) {
  const tasks = await readJsonLines(resolve(root, 'tasks', file));
  validateTaskSet(tasks);
  counts.push(`${file}: ${tasks.length} tasks`);
}

// The checked-in fixture is scored against the task set it was recorded for.
const v1 = await readJsonLines(resolve(root, 'tasks/v1.jsonl'));
const fixture = await readJsonLines(resolve(root, 'fixtures/sample-runs.jsonl'));
scoreRecords(v1, fixture);

const policy = JSON.parse(await readFile(resolve(root, 'publication-policy.json'), 'utf8'));
validatePolicy(policy);
const resultDirectoryFiles = await readdir(resolve(root, 'results'));
const resultFiles = resultDirectoryFiles.filter((name) => /\.runs\.jsonl$/.test(name)).sort();
const resultStems = new Set(resultFiles.map((name) => name.replace(/\.runs\.jsonl$/, '')));
const summaryStems = new Set(
  resultDirectoryFiles.filter((name) => /\.summary\.json$/.test(name)).map((name) => name.replace(/\.summary\.json$/, '')),
);
const orphanRuns = [...resultStems].filter((stem) => !summaryStems.has(stem));
const orphanSummaries = [...summaryStems].filter((stem) => !resultStems.has(stem));
if (orphanRuns.length || orphanSummaries.length) {
  throw new Error(
    `Public results need matching runs and summary files; missing summaries: ${orphanRuns.join(', ') || 'none'}; missing runs: ${orphanSummaries.join(', ') || 'none'}`,
  );
}
for (const file of resultFiles) {
  const version = file.match(/-v(\d+)\.runs\.jsonl$/)?.[1];
  if (!version) throw new Error(`${file}: result filename must identify its task-set version`);
  const taskPath = resolve(root, `tasks/v${version}.jsonl`);
  const taskBytes = await readFile(taskPath);
  const taskSetSha256 = createHash('sha256').update(taskBytes).digest('hex');
  const tasks = await readJsonLines(taskPath);
  const records = await readJsonLines(resolve(root, 'results', file));
  validatePublicRecords(records, policy);
  validateOfficialPublicRun(records, { taskSetSha256 });
  const generatedSummary = scoreRecords(tasks, records, { taskSetSha256 });
  const summaryFile = file.replace(/\.runs\.jsonl$/, '.summary.json');
  const publishedSummary = JSON.parse(await readFile(resolve(root, 'results', summaryFile), 'utf8'));
  if (!isDeepStrictEqual(comparableSummary(generatedSummary), comparableSummary(publishedSummary))) {
    throw new Error(`${summaryFile}: summary does not match its public run records`);
  }
}

process.stdout.write(
  `Validated ${counts.join(', ')}, ${fixture.length} fixture records, and ${resultFiles.length} public result files\n`,
);

function comparableSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return summary;
  const { generated_at: _generatedAt, ...comparable } = summary;
  return comparable;
}
