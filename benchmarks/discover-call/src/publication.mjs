import { createHash } from 'node:crypto';

import { validateTaskSet } from './harness.mjs';
import { scoreRecord } from './scoring.mjs';

const PUBLIC_API_HOSTS = new Set(['qveris.ai', 'qveris.cn']);
const PUBLIC_LANES = new Set(['model', 'reference', 'configured-model', 'pinned-model', 'current-model']);

const PUBLIC_RECORD_FIELDS = new Set([
  'schema_version',
  'benchmark_version',
  'run_id',
  'model',
  'metadata',
  'task_id',
  'trial',
  'started_at',
  'status',
  'discovery',
  'selection',
  'inspection',
  'parameterization',
  'call',
  'error',
  'finished_at',
  'source_record_sha256',
]);

const PUBLIC_METADATA_FIELDS = new Set([
  'lane',
  'model_revision',
  'adapter_revision',
  'toolkit_revision',
  'task_set_sha256',
  'api_base_url',
  'api_revision',
  'catalog_revision',
  'catalog_observation_sha256',
  'runtime',
  'discovery_limit',
  'execute',
  'publication_policy',
]);

const PUBLIC_RUNTIME_FIELDS = new Set(['node', 'platform', 'arch']);
const PUBLIC_DISCOVERY_FIELDS = new Set(['result_count', 'snapshot_sha256', 'selection_grounded']);
const PUBLIC_SELECTION_FIELDS = new Set(['tool_id', 'tool_id_sha256']);
const PUBLIC_INSPECTION_FIELDS = new Set(['selection_grounded']);
const PUBLIC_PARAMETERIZATION_FIELDS = new Set(['required_parameter_accuracy', 'constraint_accuracy']);
const PUBLIC_CALL_FIELDS = new Set(['attempted', 'success', 'result_nonempty']);
const PUBLIC_ERROR_FIELDS = new Set(['stage', 'reason_code']);

const REQUIRED_FORBIDDEN_FIELDS = [
  'execution_id',
  'search_id',
  'session_id',
  'connection_id',
  'remaining_credits',
  'result_tool_ids',
  'returned_tool_ids',
  'api_key',
  'access_token',
  'refresh_token',
  'oauth_token',
  'authorization',
  'client_secret',
  'password',
  'parameters',
  'required_parameters',
];

export function sanitizePublicRecords(records, policy, tasks) {
  validatePolicy(policy);
  const taskById = taskMap(tasks);
  const approvedToolIds = new Set(policy.approved_selected_tool_ids);
  const catalogObservationSha256 = sha256(
    JSON.stringify(
      records.map((record) => ({
        task_id: record.task_id,
        trial: record.trial,
        result_tool_ids: array(record.discovery?.result_tool_ids),
      })),
    ),
  );
  const declaredCatalogDigests = new Set(
    records
      .map((record) => record.metadata?.catalog_observation_sha256)
      .filter((value) => value !== undefined && value !== 'pending'),
  );
  if (
    declaredCatalogDigests.size > 1 ||
    (declaredCatalogDigests.size === 1 && !declaredCatalogDigests.has(catalogObservationSha256))
  ) {
    throw new Error('Raw benchmark catalog observation digest does not match its records');
  }
  const sanitized = records.map((record) =>
    sanitizePublicRecord(record, taskById.get(record.task_id), policy, approvedToolIds, catalogObservationSha256),
  );
  validatePublicRecords(sanitized, policy);
  return sanitized;
}

function sanitizePublicRecord(
  record,
  task,
  policy,
  approvedToolIds = new Set(policy.approved_selected_tool_ids),
  catalogObservationSha256 = record.metadata?.catalog_observation_sha256 ?? 'unreported',
) {
  if (!task) {
    throw new Error(`Public artifact references unknown task: ${record?.task_id ?? '<missing>'}`);
  }
  const selectedToolId = record.selection?.tool_id ?? null;
  const selectedToolApproved = selectedToolId ? approvedToolIds.has(selectedToolId) : false;
  const { parameterization: _untrustedParameterization, ...rawScoringRecord } = record;
  const scored = scoreRecord(task, rawScoringRecord);

  const resultToolIds = array(record.discovery?.result_tool_ids);
  const returnedToolIds = array(record.inspection?.returned_tool_ids);
  const selectionGrounded = selectedToolId ? resultToolIds.includes(selectedToolId) : false;
  const inspectionGrounded = selectedToolId ? returnedToolIds.includes(selectedToolId) : false;
  const call = {
    attempted: record.call?.attempted === true,
    success: record.call?.success ?? null,
  };
  if (typeof record.call?.result_nonempty === 'boolean') {
    call.result_nonempty = record.call.result_nonempty;
  } else if (typeof record.call?.result_valid === 'boolean') {
    call.result_nonempty = record.call.result_valid;
  }

  const sanitized = {
    schema_version: record.schema_version,
    benchmark_version: record.benchmark_version,
    run_id: record.run_id,
    model: record.model,
    metadata: publicMetadata(record.metadata, policy, catalogObservationSha256),
    task_id: record.task_id,
    trial: record.trial,
    started_at: record.started_at,
    status: record.status,
    discovery: {
      result_count: resultToolIds.length,
      snapshot_sha256: sha256(JSON.stringify(resultToolIds)),
      selection_grounded: selectionGrounded,
    },
    selection: {
      tool_id: selectedToolApproved ? selectedToolId : null,
      ...(selectedToolId && !selectedToolApproved ? { tool_id_sha256: sha256(selectedToolId) } : {}),
    },
    inspection: {
      selection_grounded: inspectionGrounded,
    },
    parameterization: {
      required_parameter_accuracy: scored.required_parameter_accuracy,
      constraint_accuracy: scored.constraint_accuracy,
    },
    call,
    ...(record.error ? { error: publicError(record.error) } : {}),
    finished_at: record.finished_at,
    source_record_sha256: sha256(JSON.stringify(record)),
  };
  assertNoForbiddenFields(sanitized, forbiddenFieldSet(policy));
  return sanitized;
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || policy.schema_version !== 1) {
    throw new Error('Publication policy schema_version must be 1');
  }
  if (!safePublicString(policy.policy_id, 128)) {
    throw new Error('Publication policy needs a policy_id');
  }
  if (policy.catalog_visibility_default !== 'private') {
    throw new Error('Public artifact policy must default catalog visibility to private');
  }
  if (
    !Array.isArray(policy.approved_selected_tool_ids) ||
    policy.approved_selected_tool_ids.some((toolId) => !safePublicString(toolId, 512))
  ) {
    throw new Error('Publication policy needs approved_selected_tool_ids');
  }
  if (
    !Array.isArray(policy.approved_api_base_urls) ||
    policy.approved_api_base_urls.length === 0 ||
    policy.approved_api_base_urls.some((url) => !safePublicApiUrl(url))
  ) {
    throw new Error('Publication policy needs approved public API base URLs');
  }
  if (!Array.isArray(policy.forbidden_fields)) {
    throw new Error('Publication policy needs forbidden_fields');
  }
  const forbidden = forbiddenFieldSet(policy);
  const missingForbidden = REQUIRED_FORBIDDEN_FIELDS.filter((field) => !forbidden.has(normalizeFieldName(field)));
  if (missingForbidden.length > 0) {
    throw new Error(`Publication policy must forbid protected fields: ${missingForbidden.join(', ')}`);
  }
  if (
    policy.legacy_lane_rewrites !== undefined &&
    (!plainObject(policy.legacy_lane_rewrites) ||
      Object.values(policy.legacy_lane_rewrites).some((lane) => !PUBLIC_LANES.has(lane)))
  ) {
    throw new Error('Publication policy legacy_lane_rewrites must map to public lanes');
  }
  if (policy.unapproved_selected_tool_handling !== 'hash') {
    throw new Error('Publication policy must hash unapproved selected tools');
  }
  if (policy.publish_parameters !== false) {
    throw new Error('Publication policy must not publish raw parameter values');
  }
}

export function validatePublicRecords(records, policy) {
  validatePolicy(policy);
  const approvedToolIds = new Set(policy.approved_selected_tool_ids);
  const forbidden = forbiddenFieldSet(policy);
  for (const record of records) {
    assertNoForbiddenFields(record, forbidden);
    assertObjectFields(record, PUBLIC_RECORD_FIELDS, '$');
    if (
      record.schema_version !== 1 ||
      !['v1', 'v2'].includes(record.benchmark_version) ||
      !safePublicString(record.run_id, 256) ||
      !safePublicString(record.model, 256) ||
      !safePublicString(record.task_id, 256) ||
      !Number.isInteger(record.trial) ||
      record.trial < 1 ||
      record.trial > 100 ||
      !['completed', 'failed'].includes(record.status) ||
      !validTimestamp(record.started_at) ||
      !validTimestamp(record.finished_at)
    ) {
      throw new Error('Public artifact has invalid record identity or lifecycle fields');
    }
    if (
      Date.parse(record.finished_at) < Date.parse(record.started_at) ||
      (record.status === 'failed') !== (record.error !== undefined)
    ) {
      throw new Error('Public artifact has inconsistent lifecycle fields');
    }
    if (record.metadata?.publication_policy !== policy.policy_id) {
      throw new Error(`Public artifact is missing publication policy ${policy.policy_id}`);
    }
    assertObjectFields(record.metadata, PUBLIC_METADATA_FIELDS, '$.metadata');
    assertObjectFields(record.metadata.runtime, PUBLIC_RUNTIME_FIELDS, '$.metadata.runtime');
    assertObjectFields(record.discovery, PUBLIC_DISCOVERY_FIELDS, '$.discovery');
    assertObjectFields(record.selection, PUBLIC_SELECTION_FIELDS, '$.selection');
    assertObjectFields(record.inspection, PUBLIC_INSPECTION_FIELDS, '$.inspection');
    assertObjectFields(record.parameterization, PUBLIC_PARAMETERIZATION_FIELDS, '$.parameterization');
    assertObjectFields(record.call, PUBLIC_CALL_FIELDS, '$.call');
    if (record.error !== undefined) {
      assertObjectFields(record.error, PUBLIC_ERROR_FIELDS, '$.error');
    }
    const selectedToolId = record.selection?.tool_id;
    if (!policy.approved_api_base_urls.includes(record.metadata.api_base_url)) {
      throw new Error(`Public artifact contains an unapproved API base URL`);
    }
    if (
      !isSha256(record.metadata.task_set_sha256) ||
      !isSha256(record.metadata.catalog_observation_sha256) ||
      !Number.isInteger(record.metadata.discovery_limit) ||
      record.metadata.discovery_limit < 1 ||
      record.metadata.discovery_limit > 100 ||
      typeof record.metadata.execute !== 'boolean'
    ) {
      throw new Error('Public artifact has invalid reproducibility metadata');
    }
    if (
      !PUBLIC_LANES.has(record.metadata.lane) ||
      !safePublicString(record.metadata.model_revision, 256) ||
      !safePublicString(record.metadata.adapter_revision, 256) ||
      !safePublicString(record.metadata.toolkit_revision, 256) ||
      !safePublicString(record.metadata.api_revision, 256) ||
      !safePublicString(record.metadata.catalog_revision, 256) ||
      !safePublicString(record.metadata.runtime.node, 128) ||
      !safePublicString(record.metadata.runtime.platform, 128) ||
      !safePublicString(record.metadata.runtime.arch, 128)
    ) {
      throw new Error('Public artifact has invalid public metadata values');
    }
    if (record.metadata.lane === 'pinned-model' && record.metadata.model_revision === 'unreported') {
      throw new Error('Public pinned-model artifact needs an immutable model revision');
    }
    if (selectedToolId && !approvedToolIds.has(selectedToolId)) {
      throw new Error(`Public artifact contains an unapproved selected tool: ${selectedToolId}`);
    }
    if (selectedToolId !== null && !nonemptyString(selectedToolId)) {
      throw new Error('Public artifact selected tool must be a string or null');
    }
    if (
      record.selection?.tool_id_sha256 !== undefined &&
      (!isSha256(record.selection.tool_id_sha256) || selectedToolId)
    ) {
      throw new Error('Public artifact selected tool digest is invalid');
    }
    if (
      !Number.isInteger(record.discovery?.result_count) ||
      record.discovery.result_count < 0 ||
      record.discovery.result_count > record.metadata.discovery_limit ||
      (record.discovery.result_count === 0 && record.discovery.snapshot_sha256 !== sha256('[]')) ||
      !isSha256(record.discovery?.snapshot_sha256)
    ) {
      throw new Error('Public artifact discovery needs a count and SHA-256 snapshot');
    }
    if (!isSha256(record.source_record_sha256)) {
      throw new Error('Public artifact needs source_record_sha256');
    }
    if (
      !metric(record.parameterization?.required_parameter_accuracy) ||
      !metric(record.parameterization?.constraint_accuracy)
    ) {
      throw new Error('Public artifact parameterization metrics must be between 0 and 1');
    }
    if (
      typeof record.discovery?.selection_grounded !== 'boolean' ||
      typeof record.inspection?.selection_grounded !== 'boolean'
    ) {
      throw new Error('Public artifact grounding attestations must be booleans');
    }
    const hasSelectionIdentity = Boolean(selectedToolId || record.selection?.tool_id_sha256);
    if (
      (record.discovery.selection_grounded && (record.discovery.result_count === 0 || !hasSelectionIdentity)) ||
      (record.inspection.selection_grounded && (!record.discovery.selection_grounded || !hasSelectionIdentity)) ||
      (record.status === 'completed' && (!record.discovery.selection_grounded || !record.inspection.selection_grounded))
    ) {
      throw new Error('Public artifact has inconsistent grounding attestations');
    }
    if (
      typeof record.call?.attempted !== 'boolean' ||
      !booleanOrNull(record.call?.success) ||
      (record.call?.result_nonempty !== undefined && typeof record.call.result_nonempty !== 'boolean')
    ) {
      throw new Error('Public artifact call fields have invalid types');
    }
    if (
      (!record.call.attempted && (record.call.success !== null || record.call.result_nonempty !== undefined)) ||
      (record.call.result_nonempty === true && record.call.success !== true) ||
      (record.call.attempted && record.metadata.execute !== true) ||
      (record.status === 'completed' && record.metadata.execute === true && record.call.attempted !== true) ||
      (record.status === 'completed' && record.call.attempted && typeof record.call.success !== 'boolean') ||
      (record.status === 'failed' && (record.call.success !== null || record.call.result_nonempty !== undefined))
    ) {
      throw new Error('Public artifact has inconsistent call lifecycle');
    }
    if (
      record.error !== undefined &&
      (safeCode(record.error.stage) === null ||
        safeCode(record.error.stage) !== record.error.stage ||
        (record.error.reason_code !== null && safeCode(record.error.reason_code) !== record.error.reason_code))
    ) {
      throw new Error('Public artifact error codes are invalid');
    }
  }
}

export function validateOfficialPublicRun(records, { taskSetSha256, minTrialsPerTask = 3 } = {}) {
  if (!isSha256(taskSetSha256)) throw new Error('Official public run needs the task-set SHA-256');
  if (!Number.isInteger(minTrialsPerTask) || minTrialsPerTask < 1) {
    throw new Error('minTrialsPerTask must be a positive integer');
  }
  const trials = new Map();
  for (const record of records) {
    if (record.metadata?.task_set_sha256 !== taskSetSha256) {
      throw new Error(`Public artifact task-set digest does not match ${record.task_id}`);
    }
    if (record.metadata?.execute !== true) {
      throw new Error(`Official public artifact must execute every trial: ${record.task_id}`);
    }
    if (record.benchmark_version === 'v2') {
      if (record.metadata?.lane === 'model') {
        throw new Error('Official benchmark v2 artifacts need an explicit comparison lane');
      }
      if (
        ['reference', 'pinned-model'].includes(record.metadata?.lane) &&
        record.metadata?.model_revision === 'unreported'
      ) {
        throw new Error(`Official ${record.metadata.lane} artifact needs an immutable model revision`);
      }
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(record.metadata?.toolkit_revision ?? '')) {
        throw new Error('Official benchmark v2 artifact needs a toolkit commit SHA');
      }
      if (record.metadata?.adapter_revision === 'unreported') {
        throw new Error('Official benchmark v2 artifact needs an adapter revision');
      }
    }
    const key = `${record.model}\0${record.task_id}`;
    trials.set(key, (trials.get(key) ?? 0) + 1);
  }
  for (const [key, count] of trials) {
    if (count < minTrialsPerTask) {
      const taskId = key.slice(key.indexOf('\0') + 1);
      throw new Error(`Official public artifact needs at least ${minTrialsPerTask} trials for ${taskId}`);
    }
  }
}

function publicMetadata(metadata = {}, policy, catalogObservationSha256) {
  const hasPinnedRevision =
    metadata.lane === 'pinned-model' &&
    typeof metadata.model_revision === 'string' &&
    metadata.model_revision !== 'unreported';
  const lane = hasPinnedRevision
    ? 'pinned-model'
    : (policy.legacy_lane_rewrites?.[metadata.lane] ?? metadata.lane ?? 'model');
  if (!policy.approved_api_base_urls.includes(metadata.api_base_url)) {
    throw new Error('Raw benchmark record uses an unapproved public API base URL');
  }
  return {
    lane,
    model_revision: metadata.model_revision ?? 'unreported',
    adapter_revision: metadata.adapter_revision ?? 'unreported',
    toolkit_revision: metadata.toolkit_revision ?? 'unreported',
    task_set_sha256: metadata.task_set_sha256 ?? 'unreported',
    api_base_url: metadata.api_base_url ?? 'unreported',
    api_revision: metadata.api_revision ?? 'unreported',
    catalog_revision: metadata.catalog_revision ?? 'unreported',
    catalog_observation_sha256: catalogObservationSha256,
    runtime: {
      node: metadata.runtime?.node ?? 'unreported',
      platform: metadata.runtime?.platform ?? 'unreported',
      arch: metadata.runtime?.arch ?? 'unreported',
    },
    discovery_limit: metadata.discovery_limit ?? 'unreported',
    execute: metadata.execute === true,
    publication_policy: policy.policy_id,
  };
}

function assertNoForbiddenFields(value, forbidden, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, forbidden, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(normalizeFieldName(key))) {
      throw new Error(`Forbidden public artifact field at ${path}.${key}`);
    }
    assertNoForbiddenFields(child, forbidden, `${path}.${key}`);
  }
}

function assertObjectFields(value, allowed, path) {
  if (!plainObject(value)) throw new Error(`Public artifact field ${path} must be an object`);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`Public artifact contains unsupported field at ${path}.${field}`);
    }
  }
}

function publicError(error) {
  return {
    stage: safeCode(error?.stage),
    reason_code: safeCode(error?.reason_code) ?? 'unclassified',
  };
}

function safeCode(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : null;
}

function normalizeFieldName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function forbiddenFieldSet(policy) {
  return new Set(policy.forbidden_fields.map(normalizeFieldName));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function metric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' || value === null;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function safePublicString(value, maxLength) {
  return (
    nonemptyString(value) && value.trim().length > 0 && value.length <= maxLength && !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function safePublicApiUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      PUBLIC_API_HOSTS.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname.replace(/\/+$/, '') === '/api/v1'
    );
  } catch {
    return false;
  }
}

function taskMap(tasks) {
  validateTaskSet(tasks);
  const result = new Map();
  for (const task of tasks) {
    result.set(task.id, task);
  }
  return result;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
