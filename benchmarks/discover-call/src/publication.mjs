import { createHash } from 'node:crypto';

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

const REQUIRED_FORBIDDEN_FIELDS = [
  'execution_id',
  'search_id',
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
];

export function sanitizePublicRecords(records, policy) {
  validatePolicy(policy);
  const approvedToolIds = new Set(policy.approved_selected_tool_ids);
  const catalogObservationSha256 =
    commonMetadataValue(records, 'catalog_observation_sha256') ??
    sha256(
      JSON.stringify(
        records.map((record) => ({
          task_id: record.task_id,
          trial: record.trial,
          result_tool_ids: array(record.discovery?.result_tool_ids),
        })),
      ),
    );
  return records.map((record) =>
    sanitizePublicRecord(record, policy, approvedToolIds, catalogObservationSha256),
  );
}

export function sanitizePublicRecord(
  record,
  policy,
  approvedToolIds = new Set(policy.approved_selected_tool_ids),
  catalogObservationSha256 = record.metadata?.catalog_observation_sha256 ?? 'unreported',
) {
  const selectedToolId = record.selection?.tool_id ?? null;
  const selectedToolApproved = selectedToolId ? approvedToolIds.has(selectedToolId) : false;

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
      ...(selectedToolId && !selectedToolApproved
        ? { tool_id_sha256: sha256(selectedToolId) }
        : {}),
    },
    inspection: {
      selection_grounded: inspectionGrounded,
      required_parameters: array(record.inspection?.required_parameters),
    },
    parameters: policy.publish_parameters === true ? record.parameters : null,
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
  if (typeof policy.policy_id !== 'string' || !policy.policy_id) {
    throw new Error('Publication policy needs a policy_id');
  }
  if (policy.catalog_visibility_default !== 'private') {
    throw new Error('Public artifact policy must default catalog visibility to private');
  }
  if (
    !Array.isArray(policy.approved_selected_tool_ids) ||
    policy.approved_selected_tool_ids.some((toolId) => typeof toolId !== 'string' || !toolId)
  ) {
    throw new Error('Publication policy needs approved_selected_tool_ids');
  }
  if (!Array.isArray(policy.forbidden_fields)) {
    throw new Error('Publication policy needs forbidden_fields');
  }
  const forbidden = forbiddenFieldSet(policy);
  const missingForbidden = REQUIRED_FORBIDDEN_FIELDS.filter(
    (field) => !forbidden.has(normalizeFieldName(field)),
  );
  if (missingForbidden.length > 0) {
    throw new Error(
      `Publication policy must forbid protected fields: ${missingForbidden.join(', ')}`,
    );
  }
  if (
    policy.legacy_lane_rewrites !== undefined &&
    (!plainObject(policy.legacy_lane_rewrites) ||
      Object.values(policy.legacy_lane_rewrites).some((lane) => typeof lane !== 'string' || !lane))
  ) {
    throw new Error('Publication policy legacy_lane_rewrites must map strings to strings');
  }
  if (policy.unapproved_selected_tool_handling !== 'hash') {
    throw new Error('Publication policy must hash unapproved selected tools');
  }
}

export function validatePublicRecords(records, policy) {
  validatePolicy(policy);
  const approvedToolIds = new Set(policy.approved_selected_tool_ids);
  const forbidden = forbiddenFieldSet(policy);
  for (const record of records) {
    assertNoForbiddenFields(record, forbidden);
    if (record.metadata?.publication_policy !== policy.policy_id) {
      throw new Error(`Public artifact is missing publication policy ${policy.policy_id}`);
    }
    for (const field of Object.keys(record.metadata ?? {})) {
      if (!PUBLIC_METADATA_FIELDS.has(field)) {
        throw new Error(`Public artifact contains unsupported metadata: ${field}`);
      }
    }
    const selectedToolId = record.selection?.tool_id;
    if (selectedToolId && !approvedToolIds.has(selectedToolId)) {
      throw new Error(`Public artifact contains an unapproved selected tool: ${selectedToolId}`);
    }
    if (
      record.selection?.tool_id_sha256 !== undefined &&
      (!isSha256(record.selection.tool_id_sha256) || selectedToolId)
    ) {
      throw new Error('Public artifact selected tool digest is invalid');
    }
    if (
      !Number.isInteger(record.discovery?.result_count) ||
      !isSha256(record.discovery?.snapshot_sha256)
    ) {
      throw new Error('Public artifact discovery needs a count and SHA-256 snapshot');
    }
    if (!isSha256(record.source_record_sha256)) {
      throw new Error('Public artifact needs source_record_sha256');
    }
    if (record.error) {
      const errorFields = Object.keys(record.error);
      if (errorFields.some((field) => !['stage', 'reason_code'].includes(field))) {
        throw new Error('Public artifact error contains unsupported fields');
      }
    }
  }
}

function publicMetadata(metadata = {}, policy, catalogObservationSha256) {
  const lane = policy.legacy_lane_rewrites?.[metadata.lane] ?? metadata.lane ?? 'model';
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

function commonMetadataValue(records, field) {
  if (records.length === 0) return null;
  const values = records.map((record) => record.metadata?.[field]);
  if (values.some((value) => !isSha256(value))) return null;
  const unique = new Set(values);
  return unique.size === 1 ? values[0] : null;
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

function publicError(error) {
  return {
    stage: safeCode(error?.stage),
    reason_code: safeCode(error?.reason_code),
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

function array(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
