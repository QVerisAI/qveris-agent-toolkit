import { randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const BENCHMARK_VERSION = 'v1';

export function validateTask(task) {
  if (!task || typeof task !== 'object') throw new Error('Task must be an object');
  if (typeof task.id !== 'string' || !task.id.trim()) throw new Error('Task id must be a non-empty string');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
    throw new Error(`Task ${task.id}: prompt must be a non-empty string`);
  }
  if (!Array.isArray(task.constraints) || task.constraints.length === 0) {
    throw new Error(`Task ${task.id}: constraints must be a non-empty array`);
  }
  for (const constraint of task.constraints) {
    if (typeof constraint.id !== 'string' || !constraint.id) {
      throw new Error(`Task ${task.id}: every constraint needs an id`);
    }
    if (
      !Array.isArray(constraint.aliases) ||
      constraint.aliases.length === 0 ||
      constraint.aliases.some((alias) => typeof alias !== 'string' || !alias)
    ) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} needs string aliases`);
    }
    if (!('value' in constraint)) throw new Error(`Task ${task.id}: constraint ${constraint.id} needs a value`);
    if (constraint.match !== undefined && !['equals', 'contains'].includes(constraint.match)) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} has an unsupported match mode`);
    }
  }
  return task;
}

export async function runBenchmark({
  tasks,
  model,
  trials = 3,
  execute = false,
  limit = 10,
  api,
  invokeAdapter,
  metadata = {},
  now = () => new Date().toISOString(),
  newRunId = randomUUID,
}) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('At least one benchmark task is required');
  if (typeof model !== 'string' || !model.trim()) throw new Error('A model identifier is required');
  if (!Number.isInteger(trials) || trials < 1 || trials > 100)
    throw new Error('trials must be an integer from 1 to 100');
  if (
    !api ||
    typeof api.discover !== 'function' ||
    typeof api.inspect !== 'function' ||
    typeof api.call !== 'function'
  ) {
    throw new Error('api must implement discover, inspect, and call');
  }
  if (typeof invokeAdapter !== 'function') throw new Error('invokeAdapter must be a function');

  const records = [];
  for (const rawTask of tasks) {
    const task = validateTask(rawTask);
    for (let trial = 1; trial <= trials; trial++) {
      records.push(await runTrial({ task, model, trial, execute, limit, api, invokeAdapter, metadata, now, newRunId }));
    }
  }
  return records;
}

async function runTrial({ task, model, trial, execute, limit, api, invokeAdapter, metadata, now, newRunId }) {
  const record = {
    schema_version: SCHEMA_VERSION,
    benchmark_version: BENCHMARK_VERSION,
    run_id: newRunId(),
    model,
    metadata,
    task_id: task.id,
    trial,
    started_at: now(),
    status: 'failed',
    discovery: { result_tool_ids: [] },
    selection: { tool_id: null },
    inspection: { returned_tool_ids: [], required_parameters: [] },
    parameters: null,
    call: { attempted: false, success: null },
  };

  try {
    const discovered = await api.discover({ query: task.discover_query || task.prompt, limit });
    const results = array(discovered?.results);
    record.discovery.result_tool_ids = results.map(toolId).filter(Boolean);

    const selection = await invokeAdapter(
      adapterPayload({ stage: 'select', model, task, discovery: discovered, trial }),
    );
    const selectedToolId = toolId(selection);
    if (!selectedToolId) throw stageError('select', 'Adapter did not return a non-empty tool_id');
    record.selection.tool_id = selectedToolId;

    const inspected = await api.inspect({ toolIds: [selectedToolId], discoveryId: discovered?.search_id });
    const inspectedResults = array(inspected?.results);
    record.inspection.returned_tool_ids = inspectedResults.map(toolId).filter(Boolean);
    const selectedTool = inspectedResults.find((item) => toolId(item) === selectedToolId) || inspectedResults[0];
    record.inspection.required_parameters = requiredParameterNames(selectedTool);

    const parameterized = await invokeAdapter(
      adapterPayload({
        stage: 'parameterize',
        model,
        task,
        selectedTool,
        discoveryId: discovered?.search_id ?? null,
        trial,
      }),
    );
    if (!isPlainObject(parameterized?.parameters)) {
      throw stageError('parameterize', 'Adapter did not return a parameters object');
    }
    record.parameters = parameterized.parameters;

    if (execute) {
      record.call.attempted = true;
      const response = await api.call({
        toolId: selectedToolId,
        discoveryId: discovered?.search_id,
        parameters: parameterized.parameters,
      });
      record.call.success = response?.success === true;
      record.call.execution_id = response?.execution_id ?? null;
    }

    record.status = 'completed';
  } catch (error) {
    record.error = {
      stage: error?.benchmarkStage || 'unknown',
      message: safeErrorMessage(error),
    };
  }
  record.finished_at = now();
  return record;
}

function requiredParameterNames(tool) {
  return array(tool?.params)
    .filter((parameter) => parameter?.required === true && typeof parameter?.name === 'string')
    .map((parameter) => parameter.name);
}

function adapterPayload({ stage, model, task, discovery, selectedTool, discoveryId, trial }) {
  const input =
    stage === 'select'
      ? { task_id: task.id, prompt: task.prompt, discovery }
      : { task_id: task.id, prompt: task.prompt, selected_tool: selectedTool ?? null, discovery_id: discoveryId };
  const responseSchema =
    stage === 'select'
      ? {
          type: 'object',
          additionalProperties: false,
          required: ['tool_id'],
          properties: { tool_id: { type: 'string' } },
        }
      : {
          type: 'object',
          additionalProperties: false,
          required: ['parameters'],
          properties: { parameters: { type: 'object' } },
        };
  const instruction =
    stage === 'select'
      ? 'Select one tool from the discovery results that best fulfills the user request. Return JSON only.'
      : 'Construct valid parameters for the inspected tool that fulfill the user request. Return JSON only.';
  return {
    adapter_protocol_version: 1,
    stage,
    model,
    trial,
    input,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify(input) },
    ],
    response_schema: responseSchema,
  };
}

function toolId(value) {
  const id = value?.tool_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stageError(stage, message) {
  const error = new Error(message);
  error.benchmarkStage = stage;
  return error;
}

function safeErrorMessage(error) {
  const stage = error?.benchmarkStage || 'benchmark';
  if (stage === 'api') return 'API request failed';
  if (stage === 'adapter') return 'Adapter invocation failed';
  return typeof error?.message === 'string' ? error.message.slice(0, 500) : 'Benchmark trial failed';
}
