#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonLines, writeTextAtomic } from './io.mjs';
import { scoreRecords } from './scoring.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const tasksPath = resolve(options.tasks);
  const [taskBytes, tasks, records] = await Promise.all([
    readFile(tasksPath),
    readJsonLines(tasksPath),
    readJsonLines(resolve(options.runs)),
  ]);
  const summary = scoreRecords(tasks, records, {
    taskSetSha256: createHash('sha256').update(taskBytes).digest('hex'),
  });
  const json = JSON.stringify(summary, null, 2) + '\n';
  if (options.output) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeTextAtomic(output, json);
    process.stdout.write(`Wrote benchmark summary to ${output}\n`);
  } else {
    process.stdout.write(json);
  }
}

function parseArgs(argv) {
  const options = { tasks: resolve(ROOT, 'tasks/v1.jsonl') };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--tasks') options.tasks = value(argv, ++index, arg);
    else if (arg === '--runs') options.runs = value(argv, ++index, arg);
    else if (arg === '--output') options.output = value(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.runs) throw new Error('--runs is required');
  return options;
}

function value(argv, index, flag) {
  if (!argv[index]) throw new Error(`${flag} requires a value`);
  return argv[index];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
