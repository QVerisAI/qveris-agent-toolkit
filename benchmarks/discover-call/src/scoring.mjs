export function scoreRecords(tasks, records) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('At least one benchmark task is required');
  if (!Array.isArray(records) || records.length === 0) throw new Error('At least one run record is required');
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const runIds = new Set();
  for (const record of records) {
    if (typeof record?.run_id !== 'string' || !record.run_id.trim()) throw new Error('Run record run_id is required');
    if (runIds.has(record.run_id)) throw new Error(`Duplicate run_id: ${record.run_id}`);
    runIds.add(record.run_id);
  }
  const scored = records.map((record) => scoreRecord(taskById.get(record.task_id), record));
  const byModel = new Map();
  for (const result of scored) {
    const group = byModel.get(result.model) || [];
    group.push(result);
    byModel.set(result.model, group);
  }
  for (const [model, results] of byModel) validateCompleteModelRun(model, tasks, results);

  return {
    schema_version: 1,
    methodology: 'discover-call-v1',
    generated_at: new Date().toISOString(),
    models: [...byModel.entries()].map(([model, results]) => aggregateModel(model, results)),
    records: scored,
  };
}

function validateCompleteModelRun(model, tasks, records) {
  const expectedTaskIds = new Set(tasks.map((task) => task.id));
  const trialsByTask = new Map();
  for (const record of records) {
    if (!expectedTaskIds.has(record.task_id)) throw new Error(`Model ${model} includes unknown task ${record.task_id}`);
    const trials = trialsByTask.get(record.task_id) || [];
    trials.push(record.trial);
    trialsByTask.set(record.task_id, trials);
  }
  for (const taskId of expectedTaskIds) {
    if (!trialsByTask.has(taskId)) throw new Error(`Model ${model} is missing task ${taskId}`);
  }
  const expectedCount = trialsByTask.get(tasks[0].id).length;
  for (const [taskId, trials] of trialsByTask) {
    if (trials.length !== expectedCount) throw new Error(`Model ${model} has inconsistent trial counts for ${taskId}`);
    const sorted = [...trials].sort((a, b) => a - b);
    for (let index = 0; index < sorted.length; index++) {
      if (sorted[index] !== index + 1) {
        throw new Error(`Model ${model} must have unique, consecutive trials for ${taskId}`);
      }
    }
  }

  // Never aggregate records collected under different benchmark conditions.
  // Undefined is a valid shared value for old/synthetic fixtures, but mixing
  // it with runner metadata is rejected.
  const comparableMetadata = [
    'adapter_revision',
    'toolkit_revision',
    'task_set_sha256',
    'api_base_url',
    'discovery_limit',
    'execute',
  ];
  for (const field of comparableMetadata) {
    const values = new Set(records.map((record) => JSON.stringify(record.metadata?.[field])));
    if (values.size > 1) throw new Error(`Model ${model} mixes different ${field} values`);
  }
}

export function scoreRecord(task, record) {
  if (!task) throw new Error(`Run record references unknown task: ${record?.task_id ?? '<missing>'}`);
  if (!record || typeof record !== 'object') throw new Error('Run record must be an object');
  if (typeof record.model !== 'string' || !record.model.trim()) throw new Error('Run record model is required');
  if (!Number.isInteger(record.trial) || record.trial < 1)
    throw new Error('Run record trial must be a positive integer');

  const selected = record.selection?.tool_id;
  const discovered = array(record.discovery?.result_tool_ids);
  const inspected = array(record.inspection?.returned_tool_ids);
  const required = array(record.inspection?.required_parameters);
  const parameters = plainObject(record.parameters) ? record.parameters : {};
  const completed = record.status === 'completed';
  const selectionGrounded = selected ? discovered.includes(selected) : false;
  const inspectionGrounded = selected ? inspected.includes(selected) : false;
  const requiredParameterAccuracy =
    required.length === 0 ? 1 : mean(required.map((name) => hasValue(parameters[name])));
  const constraintAccuracy = mean(task.constraints.map((constraint) => constraintSatisfied(parameters, constraint)));
  const executed = record.call?.attempted === true;
  const callSuccess = executed ? record.call?.success === true : null;
  const workflowSuccess =
    completed &&
    selectionGrounded &&
    inspectionGrounded &&
    requiredParameterAccuracy === 1 &&
    constraintAccuracy === 1 &&
    callSuccess === true;

  return {
    run_id: record.run_id,
    task_id: record.task_id,
    model: record.model,
    trial: record.trial,
    completed,
    executed,
    selection_grounded: selectionGrounded,
    inspection_grounded: inspectionGrounded,
    required_parameter_accuracy: round(requiredParameterAccuracy),
    constraint_accuracy: round(constraintAccuracy),
    call_success: callSuccess,
    workflow_success: workflowSuccess,
    error_stage: record.error?.stage ?? null,
    metadata: record.metadata,
  };
}

function aggregateModel(model, records) {
  const executed = records.filter((record) => record.executed);
  const workflowWins = records.filter((record) => record.workflow_success).length;
  const interval = wilsonInterval(workflowWins, records.length);
  const taskCount = new Set(records.map((record) => record.task_id)).size;
  const failuresByStage = {};
  for (const record of records) {
    if (record.error_stage) failuresByStage[record.error_stage] = (failuresByStage[record.error_stage] || 0) + 1;
  }
  return {
    model,
    tasks: taskCount,
    trials_per_task: records.length / taskCount,
    runs: records.length,
    completed: records.filter((record) => record.completed).length,
    executed: executed.length,
    selection_grounded_rate: round(mean(records.map((record) => record.selection_grounded))),
    inspection_grounded_rate: round(mean(records.map((record) => record.inspection_grounded))),
    required_parameter_accuracy: round(mean(records.map((record) => record.required_parameter_accuracy))),
    constraint_accuracy: round(mean(records.map((record) => record.constraint_accuracy))),
    call_success_rate: executed.length ? round(mean(executed.map((record) => record.call_success))) : null,
    workflow_success_rate: round(workflowWins / records.length),
    workflow_success_wilson_95: interval.map(round),
    failures_by_stage: failuresByStage,
  };
}

function constraintSatisfied(parameters, constraint) {
  for (const alias of constraint.aliases) {
    if (!hasValue(parameters[alias])) continue;
    const actual = parameters[alias];
    const expected = constraint.value;
    if (constraint.match === 'contains') {
      if (normalize(actual).includes(normalize(expected))) return 1;
    } else if (normalize(actual) === normalize(expected)) {
      return 1;
    }
  }
  return 0;
}

function normalize(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function mean(values) {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return [0, 0];
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
