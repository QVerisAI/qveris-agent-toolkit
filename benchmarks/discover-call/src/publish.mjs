#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonLines, writeJsonLines } from './io.mjs';
import { sanitizePublicRecords, validateOfficialPublicRun, validatePublicRecords } from './publication.mjs';
import { scoreRecords } from './scoring.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const taskPath = resolve(options.tasks);
  const runsPath = resolve(options.runs);
  const policyPath = resolve(options.policy);
  const outputRuns = resolve(options.outputRuns);
  const outputSummary = resolve(options.outputSummary);
  await validatePublicationPaths({
    inputs: [taskPath, runsPath, policyPath],
    outputs: [outputRuns, outputSummary],
  });
  const [taskBytes, tasks, records, policy] = await Promise.all([
    readFile(taskPath),
    readJsonLines(taskPath),
    readJsonLines(runsPath),
    readFile(policyPath, 'utf8').then(JSON.parse),
  ]);
  const publicRecords = sanitizePublicRecords(records, policy, tasks);
  validatePublicRecords(publicRecords, policy);
  validateOfficialPublicRun(publicRecords, {
    taskSetSha256: createHash('sha256').update(taskBytes).digest('hex'),
  });
  const summary = scoreRecords(tasks, publicRecords);
  await Promise.all([
    mkdir(dirname(outputRuns), { recursive: true }),
    mkdir(dirname(outputSummary), { recursive: true }),
  ]);
  await writeJsonLines(outputRuns, publicRecords);
  await writeFile(outputSummary, JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Wrote ${publicRecords.length} sanitized records and summary\n`);
}

export async function validatePublicationPaths({ inputs, outputs }) {
  const inputIdentities = await Promise.all(inputs.map(fileIdentities));
  const outputIdentities = await Promise.all(outputs.map(fileIdentities));
  if (identitiesOverlap(outputIdentities[0], outputIdentities[1])) {
    throw new Error('--output-runs and --output-summary must use different files');
  }
  for (const output of outputIdentities) {
    if (inputIdentities.some((input) => identitiesOverlap(input, output))) {
      throw new Error('Publication output files must not overwrite task, run, or policy inputs');
    }
  }
}

async function fileIdentities(path) {
  const absolute = resolve(path);
  const identities = new Set([`path:${absolute}`]);
  try {
    const canonical = await realpath(absolute);
    const info = await stat(absolute);
    identities.add(`path:${canonical}`);
    identities.add(`inode:${info.dev}:${info.ino}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      identities.add(`path:${join(await realpath(dirname(absolute)), basename(absolute))}`);
    } catch (parentError) {
      if (parentError?.code !== 'ENOENT') throw parentError;
    }
  }
  return identities;
}

function identitiesOverlap(left, right) {
  return [...left].some((identity) => right.has(identity));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
