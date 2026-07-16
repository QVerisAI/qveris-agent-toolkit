import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateTask } from './harness.mjs';
import { readJsonLines } from './io.mjs';
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
  const ids = new Set();
  for (const task of tasks) {
    validateTask(task);
    if (ids.has(task.id)) throw new Error(`${file}: duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
  counts.push(`${file}: ${tasks.length} tasks`);
}

// The checked-in fixture is scored against the task set it was recorded for.
const v1 = await readJsonLines(resolve(root, 'tasks/v1.jsonl'));
const fixture = await readJsonLines(resolve(root, 'fixtures/sample-runs.jsonl'));
scoreRecords(v1, fixture);
process.stdout.write(`Validated ${counts.join(', ')} and ${fixture.length} fixture records\n`);
