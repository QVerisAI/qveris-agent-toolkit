#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

try {
  const tasksPath = parseTasksPath(process.argv.slice(2));
  const { tasks, sha256 } = await readTasks(tasksPath);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const payload = JSON.parse(input);
  if (payload.task_set_sha256 !== sha256) throw referenceFailure('task_set_mismatch');
  const task = taskById.get(payload.input?.task_id);
  const reference = task?.reference ?? task?.oracle;
  if (!reference || !Array.isArray(reference.candidates)) throw referenceFailure('missing_reference');

  if (payload.stage === 'select') {
    const discovered = new Set(
      Array.isArray(payload.input?.discovery?.results)
        ? payload.input.discovery.results.map((tool) => tool?.tool_id).filter(Boolean)
        : [],
    );
    const candidate = reference.candidates.find((item) => discovered.has(item.tool_id));
    process.stdout.write(JSON.stringify({ tool_id: candidate?.tool_id ?? null }));
  } else if (payload.stage === 'parameterize') {
    const selectedToolId = payload.input?.selected_tool?.tool_id;
    const candidate = reference.candidates.find((item) => item.tool_id === selectedToolId);
    if (!candidate) throw referenceFailure('missing_reference_candidate');
    process.stdout.write(JSON.stringify({ parameters: candidate.parameters }));
  } else {
    throw referenceFailure('unsupported_stage');
  }
} catch (error) {
  process.stderr.write(`QVERIS_BENCHMARK_ADAPTER_ERROR=${error?.referenceCode || 'missing_reference'}\n`);
  process.exitCode = 2;
}

async function readTasks(path) {
  const bytes = await readFile(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tasks: bytes
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => JSON.parse(line)),
  };
}

function parseTasksPath(argv) {
  if (argv[0] && !argv[0].startsWith('--')) return argv[0];
  const index = argv.indexOf('--tasks');
  if (index === -1 || !argv[index + 1]) throw referenceFailure('missing_reference');
  return argv[index + 1];
}

function referenceFailure(code) {
  const error = new Error(code);
  error.referenceCode = code;
  return error;
}
