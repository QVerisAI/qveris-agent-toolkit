#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

try {
  const tasksPath = parseTasksPath(process.argv.slice(2));
  const tasks = await readTasks(tasksPath);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const payload = JSON.parse(input);
  const task = taskById.get(payload.input?.task_id);
  if (!task?.oracle || !Array.isArray(task.oracle.candidates)) throw oracleFailure('missing_oracle');

  if (payload.stage === 'select') {
    const discovered = new Set(
      Array.isArray(payload.input?.discovery?.results)
        ? payload.input.discovery.results.map((tool) => tool?.tool_id).filter(Boolean)
        : [],
    );
    const candidate = task.oracle.candidates.find((item) => discovered.has(item.tool_id));
    process.stdout.write(JSON.stringify({ tool_id: candidate?.tool_id ?? null }));
  } else if (payload.stage === 'parameterize') {
    const selectedToolId = payload.input?.selected_tool?.tool_id;
    const candidate = task.oracle.candidates.find((item) => item.tool_id === selectedToolId);
    if (!candidate) throw oracleFailure('missing_oracle_candidate');
    process.stdout.write(JSON.stringify({ parameters: candidate.parameters }));
  } else {
    throw oracleFailure('unsupported_stage');
  }
} catch (error) {
  process.stderr.write(`QVERIS_BENCHMARK_ADAPTER_ERROR=${error?.oracleCode || 'missing_oracle'}\n`);
  process.exitCode = 2;
}

async function readTasks(path) {
  const text = await readFile(path, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => JSON.parse(line));
}

function parseTasksPath(argv) {
  if (argv[0] && !argv[0].startsWith('--')) return argv[0];
  const index = argv.indexOf('--tasks');
  if (index === -1 || !argv[index + 1]) throw oracleFailure('missing_oracle');
  return argv[index + 1];
}

function oracleFailure(code) {
  const error = new Error(code);
  error.oracleCode = code;
  return error;
}
