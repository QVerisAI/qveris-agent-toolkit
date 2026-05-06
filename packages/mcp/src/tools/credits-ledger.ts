/**
 * credits_ledger MCP Tool Implementation
 *
 * Context-safe query for final credit balance movements.
 */

import type { QverisClient } from '../api/client.js';
import type { CreditsLedgerItem, CreditsLedgerRequest, CreditsLedgerResponse } from '../types.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  MAX_SEARCH_SCAN_ROWS,
  MAX_SUMMARY_ROWS,
  clampLimit,
  getLedgerItems,
  matchesLedger,
  normalizeMode,
  pickLedger,
  resolveDateRange,
  summarizeLedger,
  summarizeLedgerFromServer,
  unwrapEnvelope,
  writeJsonlExport,
  type LedgerFilterInput,
} from './audit-utils.js';

export interface CreditsLedgerInput extends LedgerFilterInput {}

export const creditsLedgerSchema = {
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
    entry_type: { type: 'string', description: 'Filter by ledger entry type, for example consume_tool_execute.' },
    direction: {
      type: 'string',
      enum: ['consume', 'grant', 'any'],
      description: 'consume for negative ledger entries, grant for positive entries. Default: any.',
      default: 'any',
    },
    min_credits: { type: 'number', description: 'Minimum absolute credit amount to match.' },
    max_credits: { type: 'number', description: 'Maximum absolute credit amount to match.' },
    limit: { type: 'number', description: 'Max rows for search mode. Default 10, hard max 50.' },
  },
};

export async function executeCreditsLedger(
  client: QverisClient,
  input: CreditsLedgerInput,
): Promise<Record<string, unknown>> {
  const mode = normalizeMode(input.mode);
  const range = resolveDateRange(input);

  if (mode === 'search') {
    const limit = clampLimit(input.limit);
    const result = await collectLedgerRows(client, input, limit, MAX_SEARCH_SCAN_ROWS, true);
    return {
      mode,
      ...range,
      shown_records: result.rows.length,
      matched_records: result.total,
      truncated: result.truncated,
      items: result.rows.map((row) => pickLedger(row)),
    };
  }

  if (mode === 'export_file') {
    const result = await collectLedgerRows(client, input, MAX_EXPORT_ROWS, MAX_EXPORT_ROWS, false);
    return writeJsonlExport('credits_ledger', result.rows, {
      ...range,
      matched_records: result.total,
      truncated: result.truncated,
      filters: exportFilters(input),
    });
  }

  const summaryLimit = clampLimit(input.limit);
  const summaryResponse = unwrapEnvelope<CreditsLedgerResponse>(
    await client.getCreditsLedger(buildQuery(input, 1, summaryLimit, true)),
  );
  if (summaryResponse.summary) {
    return summarizeLedgerFromServer(
      summaryResponse.summary,
      input,
      getLedgerItems(summaryResponse).length,
      summaryResponse.total,
    );
  }

  const result = await collectLedgerRows(client, input, MAX_SUMMARY_ROWS, MAX_SUMMARY_ROWS, false);
  return summarizeLedger(result.rows, input, result.scannedRows, result.total, result.truncated);
}

async function collectLedgerRows(
  client: QverisClient,
  input: CreditsLedgerInput,
  limit: number,
  maxRows: number,
  stopWhenLimitReached: boolean,
): Promise<{ rows: CreditsLedgerItem[]; total?: number; scannedRows: number; truncated: boolean }> {
  const rows: CreditsLedgerItem[] = [];
  let page = 1;
  let total: number | undefined;
  let scannedRows = 0;
  let truncated = false;

  while (rows.length < limit && scannedRows < maxRows) {
    const query = buildQuery(input, page, Math.min(DEFAULT_PAGE_SIZE, maxRows - scannedRows));
    const response = unwrapEnvelope<CreditsLedgerResponse>(await client.getCreditsLedger(query));
    const items = getLedgerItems(response);
    if (total === undefined) total = response.total;
    if (items.length === 0) break;
    scannedRows += items.length;
    for (const item of items) {
      if (!matchesLedger(item, input)) continue;
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

function buildQuery(input: CreditsLedgerInput, page: number, pageSize: number, summary = false): CreditsLedgerRequest {
  const range = resolveDateRange(input);
  return {
    ...range,
    summary: summary || undefined,
    bucket: summary ? input.bucket : undefined,
    entry_type: input.entry_type,
    direction: input.direction,
    min_credits: input.min_credits,
    max_credits: input.max_credits,
    limit: summary ? pageSize : undefined,
    page,
    page_size: pageSize,
  };
}

function exportFilters(input: CreditsLedgerInput): Record<string, unknown> {
  return {
    entry_type: input.entry_type,
    direction: input.direction,
    min_credits: input.min_credits,
    max_credits: input.max_credits,
  };
}
