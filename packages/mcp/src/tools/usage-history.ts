/**
 * usage_history MCP Tool Implementation
 *
 * Context-safe query for request-level usage audit history.
 */

import type { QverisClient } from '../api/client.js';
import type { UsageEventItem, UsageEventsResponse, UsageHistoryRequest } from '../types.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  MAX_SEARCH_SCAN_ROWS,
  MAX_SUMMARY_ROWS,
  clampLimit,
  getUsageItems,
  matchesUsage,
  normalizeMode,
  pickUsage,
  resolveDateRange,
  summarizeUsage,
  summarizeUsageFromServer,
  unwrapEnvelope,
  writeJsonlExport,
  type UsageFilterInput,
} from './audit-utils.js';

export interface UsageHistoryInput extends UsageFilterInput {}

export const usageHistorySchema = {
  type: 'object' as const,
  properties: {
    mode: {
      type: 'string',
      enum: ['summary', 'search', 'export_file'],
      description: 'summary returns aggregates, search returns capped rows, export_file writes JSONL locally. Default: summary.',
      default: 'summary',
    },
    start_date: { type: 'string', description: 'Start date in YYYY-MM-DD. Defaults to yesterday UTC.' },
    end_date: { type: 'string', description: 'End date in YYYY-MM-DD. Defaults to today UTC.' },
    bucket: { type: 'string', enum: ['hour', 'day', 'week'], description: 'Aggregation bucket for summary mode.' },
    execution_id: { type: 'string', description: 'Focus on one execution_id.' },
    search_id: { type: 'string', description: 'Focus on one search_id.' },
    event_type: { type: 'string', description: 'Filter by event type, for example tool_execute or search.' },
    kind: { type: 'string', description: 'Backend usage kind grouping when supported.' },
    success: { type: 'boolean', description: 'Filter by call success.' },
    charge_outcome: {
      type: 'string',
      enum: ['charged', 'included', 'failed_not_charged', 'failed_charged_review'],
      description: 'Filter by charge outcome.',
    },
    min_credits: { type: 'number', description: 'Minimum actual/requested credits to match.' },
    max_credits: { type: 'number', description: 'Maximum actual/requested credits to match.' },
    limit: { type: 'number', description: 'Max rows for search mode. Default 10, hard max 50.' },
  },
};

export async function executeUsageHistory(
  client: QverisClient,
  input: UsageHistoryInput,
): Promise<Record<string, unknown>> {
  const mode = normalizeMode(input.mode);
  const range = resolveDateRange(input);

  if (mode === 'search') {
    const limit = clampLimit(input.limit);
    const result = await collectUsageRows(client, input, limit, MAX_SEARCH_SCAN_ROWS, true);
    return {
      mode,
      ...range,
      shown_records: result.rows.length,
      matched_records: result.total,
      truncated: result.truncated,
      items: result.rows.map((row) => pickUsage(row)),
    };
  }

  if (mode === 'export_file') {
    const result = await collectUsageRows(client, input, MAX_EXPORT_ROWS, MAX_EXPORT_ROWS, false);
    return writeJsonlExport('usage_history', result.rows, {
      ...range,
      matched_records: result.total,
      truncated: result.truncated,
      filters: exportFilters(input),
    });
  }

  const summaryLimit = clampLimit(input.limit);
  const summaryResponse = unwrapEnvelope<UsageEventsResponse>(
    await client.getUsageHistory(buildQuery(input, 1, summaryLimit, true)),
  );
  if (summaryResponse.summary) {
    return summarizeUsageFromServer(
      summaryResponse.summary,
      input,
      getUsageItems(summaryResponse).length,
      summaryResponse.total,
    );
  }

  const result = await collectUsageRows(client, input, MAX_SUMMARY_ROWS, MAX_SUMMARY_ROWS, false);
  return summarizeUsage(result.rows, input, result.scannedRows, result.total, result.truncated);
}

async function collectUsageRows(
  client: QverisClient,
  input: UsageHistoryInput,
  limit: number,
  maxRows: number,
  stopWhenLimitReached: boolean,
): Promise<{ rows: UsageEventItem[]; total?: number; scannedRows: number; truncated: boolean }> {
  const rows: UsageEventItem[] = [];
  let page = 1;
  let total: number | undefined;
  let scannedRows = 0;
  let truncated = false;

  while (rows.length < limit && scannedRows < maxRows) {
    const query = buildQuery(input, page, Math.min(DEFAULT_PAGE_SIZE, maxRows - scannedRows));
    const response = unwrapEnvelope<UsageEventsResponse>(await client.getUsageHistory(query));
    const items = getUsageItems(response);
    if (total === undefined) total = response.total;
    if (items.length === 0) break;
    scannedRows += items.length;
    for (const item of items) {
      if (!matchesUsage(item, input)) continue;
      rows.push(item);
      if (stopWhenLimitReached && rows.length >= limit) break;
    }
    if (stopWhenLimitReached && rows.length >= limit) {
      truncated = Boolean(total && total > scannedRows);
      break;
    }
    if (total !== undefined && scannedRows >= total) break;
    if (items.length < DEFAULT_PAGE_SIZE) break;
    page += 1;
  }

  if (total !== undefined && scannedRows < total) truncated = true;
  if (scannedRows >= maxRows && (total === undefined || scannedRows < total)) truncated = true;
  return { rows: rows.slice(0, limit), total, scannedRows, truncated };
}

function buildQuery(input: UsageHistoryInput, page: number, pageSize: number, summary = false): UsageHistoryRequest {
  const range = resolveDateRange(input);
  return {
    ...range,
    summary: summary || undefined,
    bucket: summary ? input.bucket : undefined,
    event_type: input.event_type,
    kind: input.kind,
    success: input.success,
    charge_outcome: input.charge_outcome,
    search_id: input.search_id,
    execution_id: input.execution_id,
    min_credits: input.min_credits,
    max_credits: input.max_credits,
    limit: summary ? pageSize : undefined,
    page,
    page_size: pageSize,
  };
}

function exportFilters(input: UsageHistoryInput): Record<string, unknown> {
  return {
    execution_id: input.execution_id,
    search_id: input.search_id,
    event_type: input.event_type,
    kind: input.kind,
    success: input.success,
    charge_outcome: input.charge_outcome,
    min_credits: input.min_credits,
    max_credits: input.max_credits,
  };
}
