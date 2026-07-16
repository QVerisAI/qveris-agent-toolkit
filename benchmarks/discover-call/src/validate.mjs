import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateTask } from './harness.mjs';
import { readJsonLines } from './io.mjs';
import { scoreRecords } from './scoring.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tasks = await readJsonLines(resolve(root, 'tasks/v1.jsonl'));
const ids = new Set();
for (const task of tasks) {
  validateTask(task);
  if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
  ids.add(task.id);
}
const fixture = await readJsonLines(resolve(root, 'fixtures/sample-runs.jsonl'));
scoreRecords(tasks, fixture);
process.stdout.write(`Validated ${tasks.length} tasks and ${fixture.length} fixture records\n`);
