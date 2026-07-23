import { createHash } from 'node:crypto';

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
    ...(record.error ? { error: record.error } : {}),
    finished_at: record.finished_at,
    source_record_sha256: sha256(JSON.stringify(record)),
  };
  assertNoForbiddenFields(sanitized, new Set(policy.forbidden_fields));
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
  if (!Array.isArray(policy.forbidden_fields) || !policy.forbidden_fields.includes('execution_id')) {
    throw new Error('Publication policy must forbid execution_id');
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
  const forbidden = new Set(policy.forbidden_fields);
  for (const record of records) {
    assertNoForbiddenFields(record, forbidden);
    if (record.metadata?.publication_policy !== policy.policy_id) {
      throw new Error(`Public artifact is missing publication policy ${policy.policy_id}`);
    }
    const selectedToolId = record.selection?.tool_id;
    if (selectedToolId && !approvedToolIds.has(selectedToolId)) {
      throw new Error(`Public artifact contains an unapproved selected tool: ${selectedToolId}`);
    }
    if (
      record.selection?.tool_id_sha256 !== undefined &&
      (typeof record.selection.tool_id_sha256 !== 'string' ||
        record.selection.tool_id_sha256.length !== 64 ||
        selectedToolId)
    ) {
      throw new Error('Public artifact selected tool digest is invalid');
    }
    if (
      !Number.isInteger(record.discovery?.result_count) ||
      typeof record.discovery?.snapshot_sha256 !== 'string' ||
      record.discovery.snapshot_sha256.length !== 64
    ) {
      throw new Error('Public artifact discovery needs a count and SHA-256 snapshot');
    }
    if (typeof record.source_record_sha256 !== 'string' || record.source_record_sha256.length !== 64) {
      throw new Error('Public artifact needs source_record_sha256');
    }
  }
}

function publicMetadata(metadata = {}, policy, catalogObservationSha256) {
  const lane = policy.legacy_lane_rewrites?.[metadata.lane] ?? metadata.lane ?? 'model';
  return {
    ...metadata,
    lane,
    model_revision: metadata.model_revision ?? 'unreported',
    api_revision: metadata.api_revision ?? 'unreported',
    catalog_revision: metadata.catalog_revision ?? 'unreported',
    catalog_observation_sha256: catalogObservationSha256,
    runtime: {
      node: metadata.runtime?.node ?? 'unreported',
      platform: metadata.runtime?.platform ?? 'unreported',
      arch: metadata.runtime?.arch ?? 'unreported',
    },
    publication_policy: policy.policy_id,
  };
}

function commonMetadataValue(records, field) {
  const values = new Set(
    records
      .map((record) => record.metadata?.[field])
      .filter((value) => typeof value === 'string' && value && value !== 'pending'),
  );
  return values.size === 1 ? [...values][0] : null;
}

function assertNoForbiddenFields(value, forbidden, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, forbidden, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error(`Forbidden public artifact field at ${path}.${key}`);
    assertNoForbiddenFields(child, forbidden, `${path}.${key}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
