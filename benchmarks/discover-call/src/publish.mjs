#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonLines, writeJsonLines } from './io.mjs';
import { sanitizePublicRecords } from './publication.mjs';
import { scoreRecords } from './scoring.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [tasks, records, policy] = await Promise.all([
    readJsonLines(resolve(options.tasks)),
    readJsonLines(resolve(options.runs)),
    readFile(resolve(options.policy), 'utf8').then(JSON.parse),
  ]);
  const publicRecords = sanitizePublicRecords(records, policy);
  const summary = scoreRecords(tasks, publicRecords);
  const outputRuns = resolve(options.outputRuns);
  const outputSummary = resolve(options.outputSummary);
  await Promise.all([mkdir(dirname(outputRuns), { recursive: true }), mkdir(dirname(outputSummary), { recursive: true })]);
  await writeJsonLines(outputRuns, publicRecords);
  await writeFile(outputSummary, JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Wrote ${publicRecords.length} sanitized records and summary\n`);
}

function parseArgs(argv) {
  const options = {
    tasks: resolve(ROOT, 'tasks/v1.jsonl'),
    policy: resolve(ROOT, 'publication-policy.json'),
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--tasks') options.tasks = value(argv, ++index, arg);
    else if (arg === '--runs') options.runs = value(argv, ++index, arg);
    else if (arg === '--policy') options.policy = value(argv, ++index, arg);
    else if (arg === '--output-runs') options.outputRuns = value(argv, ++index, arg);
    else if (arg === '--output-summary') options.outputSummary = value(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const name of ['runs', 'outputRuns', 'outputSummary']) {
    if (!options[name]) throw new Error(`--${camelToKebab(name)} is required`);
  }
  return options;
}

function value(argv, index, flag) {
  if (!argv[index]) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
