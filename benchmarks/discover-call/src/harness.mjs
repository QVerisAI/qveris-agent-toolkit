import { randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const BENCHMARK_VERSION = 'v2';

export function validateTaskSet(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('At least one benchmark task is required');
  }
  const taskIds = new Set();
  for (const task of tasks) {
    validateTask(task);
    if (taskIds.has(task.id)) throw new Error(`Duplicate benchmark task id: ${task.id}`);
    taskIds.add(task.id);
  }
  return tasks;
}

export function validateTask(task) {
  if (!task || typeof task !== 'object') throw new Error('Task must be an object');
  if (typeof task.id !== 'string' || !task.id.trim() || task.id.length > 256 || /[\p{Cc}\p{Cf}]/u.test(task.id)) {
    throw new Error('Task id must be a safe non-empty string');
  }
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
    throw new Error(`Task ${task.id}: prompt must be a non-empty string`);
  }
  if (task.discover_query !== undefined && (typeof task.discover_query !== 'string' || !task.discover_query.trim())) {
    throw new Error(`Task ${task.id}: discover_query must be a non-empty string`);
  }
  if (!Array.isArray(task.constraints) || task.constraints.length === 0) {
    throw new Error(`Task ${task.id}: constraints must be a non-empty array`);
  }
  const constraintIds = new Set();
  for (const constraint of task.constraints) {
    if (typeof constraint.id !== 'string' || !constraint.id.trim()) {
      throw new Error(`Task ${task.id}: every constraint needs an id`);
    }
    if (constraintIds.has(constraint.id)) {
      throw new Error(`Task ${task.id}: duplicate constraint id ${constraint.id}`);
    }
    constraintIds.add(constraint.id);
    if (
      !Array.isArray(constraint.aliases) ||
      constraint.aliases.length === 0 ||
      constraint.aliases.some((alias) => typeof alias !== 'string' || !alias.trim()) ||
      new Set(constraint.aliases).size !== constraint.aliases.length
    ) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} needs string aliases`);
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof constraint.value) ||
      (typeof constraint.value === 'string' && !constraint.value.trim()) ||
      (typeof constraint.value === 'number' && !Number.isFinite(constraint.value))
    ) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} needs a primitive finite value`);
    }
    if (constraint.match !== undefined && !['equals', 'contains'].includes(constraint.match)) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} has an unsupported match mode`);
    }
    if (
      constraint.composite_aliases !== undefined &&
      (!Array.isArray(constraint.composite_aliases) ||
        constraint.composite_aliases.some((alias) => typeof alias !== 'string' || !alias.trim()) ||
        new Set(constraint.composite_aliases).size !== constraint.composite_aliases.length)
    ) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} has invalid composite_aliases`);
    }
    if (
      constraint.normalizers !== undefined &&
      (!Array.isArray(constraint.normalizers) ||
        constraint.normalizers.some((normalizer) => normalizer !== 'url_decode'))
    ) {
      throw new Error(`Task ${task.id}: constraint ${constraint.id} has invalid normalizers`);
    }
    if (constraint.alias_values !== undefined) {
      if (!isPlainObject(constraint.alias_values)) {
        throw new Error(`Task ${task.id}: constraint ${constraint.id} has invalid alias_values`);
      }
      for (const [alias, values] of Object.entries(constraint.alias_values)) {
        if (
          !constraint.aliases.includes(alias) ||
          !Array.isArray(values) ||
          values.length === 0 ||
          values.some(
            (value) =>
              !['string', 'number', 'boolean'].includes(typeof value) ||
              (typeof value === 'string' && !value.trim()) ||
              (typeof value === 'number' && !Number.isFinite(value)),
          )
        ) {
          throw new Error(`Task ${task.id}: constraint ${constraint.id} has invalid alias_values`);
        }
      }
    }
  }
  if (task.reference !== undefined && task.oracle !== undefined) {
    throw new Error(`Task ${task.id}: use reference or legacy oracle, not both`);
  }
  const reference = task.reference ?? task.oracle;
  if (reference !== undefined) {
    if (!reference || typeof reference !== 'object' || !Array.isArray(reference.candidates)) {
      throw new Error(`Task ${task.id}: reference.candidates must be an array`);
    }
    if (
      reference.candidates.length === 0 &&
      (typeof reference.unavailable_reason !== 'string' || !reference.unavailable_reason)
    ) {
      throw new Error(`Task ${task.id}: an empty reference needs unavailable_reason`);
    }
    for (const candidate of reference.candidates) {
      if (
        typeof candidate?.tool_id !== 'string' ||
        !candidate.tool_id.trim() ||
        !isPlainObject(candidate.parameters) ||
        !isJsonValue(candidate.parameters)
      ) {
        throw new Error(`Task ${task.id}: every reference candidate needs tool_id and parameters`);
      }
    }
    if (new Set(reference.candidates.map((candidate) => candidate.tool_id)).size !== reference.candidates.length) {
      throw new Error(`Task ${task.id}: reference candidates need unique tool ids`);
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
  newSessionId = randomUUID,
  onRecord = async () => {},
}) {
  validateTaskSet(tasks);
  if (typeof model !== 'string' || !model.trim()) throw new Error('A model identifier is required');
  if (!Number.isInteger(trials) || trials < 1 || trials > 100)
    throw new Error('trials must be an integer from 1 to 100');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit must be an integer from 1 to 100');
  }
  if (typeof execute !== 'boolean') throw new Error('execute must be a boolean');
  if (!isPlainObject(metadata)) throw new Error('metadata must be an object');
  if (typeof now !== 'function') throw new Error('now must be a function');
  if (typeof newRunId !== 'function') throw new Error('newRunId must be a function');
  if (typeof newSessionId !== 'function') throw new Error('newSessionId must be a function');
  if (typeof onRecord !== 'function') throw new Error('onRecord must be a function');
  if (
    !api ||
    typeof api.discover !== 'function' ||
    typeof api.inspect !== 'function' ||
    typeof api.call !== 'function'
  ) {
    throw new Error('api must implement discover, inspect, and call');
  }
  if (typeof invokeAdapter !== 'function') throw new Error('invokeAdapter must be a function');

  const runPlan = [];
  const runIds = new Set();
  const sessionIds = new Set();
  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial++) {
      const runId = newRunId();
      if (typeof runId !== 'string' || !runId.trim() || runId.length > 256 || /[\p{Cc}\p{Cf}]/u.test(runId)) {
        throw new Error('newRunId must return a safe non-empty string');
      }
      if (runIds.has(runId)) throw new Error(`Duplicate benchmark run id: ${runId}`);
      const sessionId = newSessionId();
      if (
        typeof sessionId !== 'string' ||
        !sessionId.trim() ||
        sessionId.length > 256 ||
        /[\p{Cc}\p{Cf}]/u.test(sessionId)
      ) {
        throw new Error('newSessionId must return a safe non-empty string');
      }
      if (sessionIds.has(sessionId)) throw new Error('Duplicate benchmark session id');
      runIds.add(runId);
      sessionIds.add(sessionId);
      runPlan.push({ task, trial, runId, sessionId });
    }
  }

  const records = [];
  for (const { task, trial, runId, sessionId } of runPlan) {
    records.push(
      await runTrial({ task, model, trial, runId, sessionId, execute, limit, api, invokeAdapter, metadata, now }),
    );
    await onRecord(records);
  }
  return records;
}

async function runTrial({ task, model, trial, runId, sessionId, execute, limit, api, invokeAdapter, metadata, now }) {
  const record = {
    schema_version: SCHEMA_VERSION,
    benchmark_version: BENCHMARK_VERSION,
    run_id: runId,
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
    const discovered = await api.discover({ query: task.discover_query || task.prompt, limit, sessionId });
    const discoveryId =
      typeof discovered?.search_id === 'string' && discovered.search_id.trim() ? discovered.search_id.trim() : null;
    if (!discoveryId) {
      throw stageError('discover', 'Discover did not return a search_id', 'missing_search_id');
    }
    const results = array(discovered?.results);
    record.discovery.result_tool_ids = results.map(toolId).filter(Boolean);

    const selection = await invokeAdapter(
      adapterPayload({
        stage: 'select',
        model,
        task,
        discovery: adapterDiscovery(discovered),
        trial,
        taskSetSha256: metadata.task_set_sha256,
      }),
    );
    const selectedToolId = toolId(selection);
    if (!selectedToolId) throw stageError('select', 'Adapter did not return a non-empty tool_id');
    record.selection.tool_id = selectedToolId;
    if (!record.discovery.result_tool_ids.includes(selectedToolId)) {
      throw stageError('select', 'Adapter selected a tool outside the discovery results', 'ungrounded_tool_id');
    }

    const inspected = await api.inspect({ toolIds: [selectedToolId], discoveryId, sessionId });
    const inspectedResults = array(inspected?.results);
    record.inspection.returned_tool_ids = inspectedResults.map(toolId).filter(Boolean);
    const selectedTool = inspectedResults.find((item) => toolId(item) === selectedToolId);
    if (!selectedTool) {
      throw stageError('inspect', 'Inspect did not return the selected tool', 'selected_tool_not_returned');
    }
    record.inspection.required_parameters = requiredParameterNames(selectedTool);

    const parameterized = await invokeAdapter(
      adapterPayload({
        stage: 'parameterize',
        model,
        task,
        selectedTool: adapterTool(selectedTool),
        trial,
        taskSetSha256: metadata.task_set_sha256,
      }),
    );
    if (!isPlainObject(parameterized?.parameters)) {
      throw stageError('parameterize', 'Adapter did not return a parameters object');
    }
    record.parameters = omitNullParameters(parameterized.parameters);
    validateAdapterParameters(selectedTool, record.parameters);

    if (execute) {
      record.call.attempted = true;
      const response = await api.call({
        toolId: selectedToolId,
        discoveryId,
        sessionId,
        model,
        parameters: record.parameters,
      });
      record.call.success = response?.success === true;
      record.call.result_nonempty = response?.success === true ? hasNonemptyResult(response?.result) : false;
    }

    record.status = 'completed';
  } catch (error) {
    record.error = {
      stage: error?.benchmarkStage || 'unknown',
      reason_code: safeReasonCode(error),
      message: safeErrorMessage(error),
    };
  }
  record.finished_at = now();
  return record;
}

function requiredParameterNames(tool) {
  const names = array(tool?.params)
    .filter((parameter) => parameter?.required === true && typeof parameter?.name === 'string')
    .map((parameter) => parameter.name);
  return [...names, ...oneOfRequiredGroups(tool)];
}

function oneOfRequiredGroups(tool) {
  const value = tool?.one_of_required;
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  const groups =
    Array.isArray(value) && value.every((name) => typeof name === 'string')
      ? [value]
      : Array.isArray(value)
        ? value
        : null;
  const parameterNames = new Set(array(tool?.params).map((parameter) => parameter?.name));
  if (
    !groups ||
    groups.length === 0 ||
    groups.some(
      (group) =>
        !Array.isArray(group) ||
        group.length === 0 ||
        group.some((name) => typeof name !== 'string' || !name.trim() || !parameterNames.has(name)),
    )
  ) {
    throw stageError(
      'parameterize',
      'Inspected tool contains invalid one_of_required metadata',
      'unsupported_parameter_schema',
    );
  }
  return groups.map((group) => [...new Set(group)]);
}

function validateAdapterParameters(tool, parameters) {
  const definitions = new Map(array(tool?.params).map((parameter) => [parameter.name, parameter]));
  for (const [name, value] of Object.entries(parameters)) {
    const definition = definitions.get(name);
    if (!definition) {
      throw stageError('parameterize', `Adapter returned unknown parameter ${name}`, 'invalid_parameter_values');
    }
    validateParameterValue(value, definition);
  }
  for (const definition of definitions.values()) {
    if (definition.required === true && !hasParameterValue(parameters[definition.name])) {
      throw stageError(
        'parameterize',
        `Adapter omitted required parameter ${definition.name}`,
        'invalid_parameter_values',
      );
    }
  }
  for (const group of oneOfRequiredGroups(tool)) {
    if (!group.some((name) => hasParameterValue(parameters[name]))) {
      throw stageError(
        'parameterize',
        `Adapter omitted one_of_required group ${group.join(',')}`,
        'invalid_parameter_values',
      );
    }
  }
}

function validateParameterValue(value, parameter, forceRequired = parameter?.required === true) {
  if (value === null) {
    if (!forceRequired) return;
    throw stageError('parameterize', 'Adapter returned null for a required parameter', 'invalid_parameter_values');
  }
  if (Array.isArray(parameter?.enum) && parameter.enum.length > 0) {
    if (!parameter.enum.includes(value)) {
      throw stageError(
        'parameterize',
        'Adapter returned a value outside the parameter enum',
        'invalid_parameter_values',
      );
    }
    return;
  }
  const type = normalizeParameterType(parameter?.type);
  const valid =
    type === 'string'
      ? typeof value === 'string'
      : type === 'integer'
        ? Number.isInteger(value)
        : type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : type === 'boolean'
            ? typeof value === 'boolean'
            : type === 'array'
              ? Array.isArray(value)
              : isPlainObject(value);
  if (!valid) {
    throw stageError('parameterize', `Adapter returned an invalid ${type} value`, 'invalid_parameter_values');
  }
  if (type === 'array') {
    if (!isPlainObject(parameter?.items)) {
      throw stageError('parameterize', 'Adapter returned an opaque array parameter', 'invalid_parameter_values');
    }
    value.forEach((item) => validateParameterValue(item, parameter.items, true));
  }
  if (type === 'object') {
    const properties = isPlainObject(parameter?.properties) ? parameter.properties : {};
    if (Object.keys(properties).length === 0) {
      throw stageError('parameterize', 'Adapter returned an opaque object parameter', 'invalid_parameter_values');
    }
    for (const [name, child] of Object.entries(value)) {
      if (!Object.hasOwn(properties, name)) {
        throw stageError('parameterize', 'Adapter returned an unknown nested parameter', 'invalid_parameter_values');
      }
      validateParameterValue(child, properties[name]);
    }
    for (const [name, child] of Object.entries(properties)) {
      if (child?.required === true && !hasParameterValue(value[name])) {
        throw stageError('parameterize', 'Adapter omitted a required nested parameter', 'invalid_parameter_values');
      }
    }
  }
}

export function parameterResponseSchema(tool) {
  const properties = {};
  for (const parameter of array(tool?.params)) {
    if (
      typeof parameter?.name !== 'string' ||
      !parameter.name.trim() ||
      typeof parameter.required !== 'boolean' ||
      Object.hasOwn(properties, parameter.name)
    ) {
      throw stageError(
        'parameterize',
        'Inspected tool contains invalid or duplicate parameter metadata',
        'unsupported_parameter_schema',
      );
    }
    properties[parameter.name] = strictParameterSchema(parameter);
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['parameters'],
    properties: {
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(properties),
        properties,
      },
    },
  };
}

function adapterPayload({ stage, model, task, discovery, selectedTool, trial, taskSetSha256 }) {
  const input =
    stage === 'select'
      ? { task_id: task.id, prompt: task.prompt, discovery }
      : { task_id: task.id, prompt: task.prompt, selected_tool: selectedTool ?? null };
  const responseSchema =
    stage === 'select'
      ? {
          type: 'object',
          additionalProperties: false,
          required: ['tool_id'],
          properties: { tool_id: { type: 'string' } },
        }
      : parameterResponseSchema(selectedTool);
  const instruction =
    stage === 'select'
      ? 'Select one tool from the discovery results that best fulfills the user request. Return JSON only.'
      : 'Construct valid parameters for the inspected tool that fulfill the user request. Return JSON only.';
  return {
    adapter_protocol_version: 1,
    stage,
    model,
    trial,
    task_set_sha256: taskSetSha256 ?? 'unreported',
    input,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify(input) },
    ],
    response_schema: responseSchema,
  };
}

function adapterDiscovery(discovery) {
  return {
    results: array(discovery?.results).map((tool) =>
      pickDefined(tool, ['tool_id', 'capability', 'cost_class', 'reliability', 'as_of_support']),
    ),
  };
}

function adapterTool(tool) {
  return pickDefined(tool, ['tool_id', 'name', 'description', 'params', 'one_of_required', 'examples']);
}

function pickDefined(value, fields) {
  return Object.fromEntries(
    fields.filter((field) => value?.[field] !== undefined).map((field) => [field, structuredClone(value[field])]),
  );
}

function strictParameterSchema(parameter, forceRequired = parameter?.required === true) {
  const type = normalizeParameterType(parameter?.type);
  const schema = {};
  if (typeof parameter?.description === 'string' && parameter.description) {
    schema.description = forceRequired
      ? parameter.description
      : `${parameter.description} Use null when this optional parameter is not needed.`;
  }

  if (parameter?.enum !== undefined && !Array.isArray(parameter.enum)) {
    throw stageError(
      'parameterize',
      `Parameter ${parameter?.name ?? '<unnamed>'} has invalid enum metadata`,
      'unsupported_parameter_schema',
    );
  }
  if (Array.isArray(parameter?.enum) && parameter.enum.length > 0) {
    if (
      parameter.enum.some(
        (value) => jsonValueType(value) === null || (typeof value === 'number' && !Number.isFinite(value)),
      )
    ) {
      throw stageError(
        'parameterize',
        `Parameter ${parameter?.name ?? '<unnamed>'} has unsupported enum values`,
        'unsupported_parameter_schema',
      );
    }
    schema.type = enumType(parameter.enum, forceRequired);
    schema.enum = forceRequired ? [...parameter.enum] : [...parameter.enum, null];
    return schema;
  }

  schema.type = nullableType(type, forceRequired);
  if (type === 'array') {
    if (!isPlainObject(parameter?.items)) {
      if (forceRequired) {
        throw stageError(
          'parameterize',
          `Required array parameter ${parameter?.name ?? '<unnamed>'} has no item schema`,
          'unsupported_parameter_schema',
        );
      }
      return { ...schema, type: 'null' };
    }
    schema.items = strictParameterSchema(parameter.items, true);
  } else if (type === 'object') {
    const nestedDefinitions = isPlainObject(parameter?.properties) ? parameter.properties : {};
    if (Object.keys(nestedDefinitions).length === 0) {
      if (forceRequired) {
        throw stageError(
          'parameterize',
          `Required object parameter ${parameter?.name ?? '<unnamed>'} has no property schema`,
          'unsupported_parameter_schema',
        );
      }
      return { ...schema, type: 'null' };
    }
    const nestedProperties = {};
    for (const [name, definition] of Object.entries(nestedDefinitions)) {
      nestedProperties[name] = strictParameterSchema(isPlainObject(definition) ? definition : { type: 'string' });
    }
    schema.additionalProperties = false;
    schema.required = Object.keys(nestedProperties);
    schema.properties = nestedProperties;
  }
  return schema;
}

function normalizeParameterType(value) {
  if (typeof value !== 'string') {
    throw stageError('parameterize', 'Parameter type is missing', 'unsupported_parameter_schema');
  }
  const type = value.toLowerCase();
  if (['integer', 'int'].includes(type)) return 'integer';
  if (['number', 'float', 'double'].includes(type)) return 'number';
  if (['boolean', 'bool'].includes(type)) return 'boolean';
  if (['array', 'list'].includes(type)) return 'array';
  if (['object', 'map'].includes(type)) return 'object';
  if (type === 'string') return 'string';
  throw stageError('parameterize', `Unsupported parameter type: ${value}`, 'unsupported_parameter_schema');
}

function nullableType(type, required) {
  return required ? type : [type, 'null'];
}

function enumType(values, required) {
  const types = [...new Set(values.map(jsonValueType).filter(Boolean))];
  const normalized = types.includes('number') ? types.filter((type) => type !== 'integer') : types;
  if (!required) normalized.push('null');
  return normalized.length === 1 ? normalized[0] : normalized;
}

function jsonValueType(value) {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  return null;
}

function omitNullParameters(parameters) {
  return Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== null));
}

function hasParameterValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function hasNonemptyResult(result) {
  if (result === null || result === undefined) return false;
  if (typeof result === 'string') return result.trim().length > 0;
  if (Array.isArray(result)) return result.length > 0;
  if (isPlainObject(result)) {
    if (Object.hasOwn(result, 'data')) return hasNonemptyResult(result.data);
    if (typeof result.truncated_content === 'string' && result.truncated_content.trim()) return true;
    if (typeof result.full_content_file_url === 'string' && result.full_content_file_url.trim()) return true;
    return Object.keys(result).length > 0;
  }
  return true;
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

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function stageError(stage, message, reason) {
  const error = new Error(message);
  error.benchmarkStage = stage;
  error.benchmarkReason = reason ?? (stage === 'select' ? 'missing_tool_id' : 'invalid_parameters');
  return error;
}

function safeReasonCode(error) {
  const reason = error?.benchmarkReason;
  return typeof reason === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(reason) ? reason : null;
}

function safeErrorMessage(error) {
  const stage = error?.benchmarkStage || 'benchmark';
  if (stage === 'api') return 'API request failed';
  if (stage === 'adapter') return 'Adapter invocation failed';
  return typeof error?.message === 'string' ? error.message.slice(0, 500) : 'Benchmark trial failed';
}
