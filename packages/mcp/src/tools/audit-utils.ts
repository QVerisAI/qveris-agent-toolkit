import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ApiEnvelope,
  CreditsLedgerItem,
  CreditsLedgerResponse,
  UsageEventItem,
  UsageEventsResponse,
} from '../types.js';

export const DEFAULT_DETAIL_LIMIT = 10;
export const MAX_DETAIL_LIMIT = 50;
export const DEFAULT_PAGE_SIZE = 500;
export const MAX_SUMMARY_ROWS = 5000;
export const MAX_SEARCH_SCAN_ROWS = 2000;
export const MAX_EXPORT_ROWS = 50000;

export type AuditMode = 'summary' | 'search' | 'export_file';
export type Bucket = 'hour' | 'day' | 'week';

export interface CommonAuditInput {
  mode?: AuditMode | 'export-file';
  start_date?: string;
  end_date?: string;
  bucket?: Bucket;
  min_credits?: number;
  max_credits?: number;
  limit?: number;
}

export interface UsageFilterInput extends CommonAuditInput {
  execution_id?: string;
  search_id?: string;
  event_type?: string;
  kind?: string;
  success?: boolean;
  charge_outcome?: string;
}

export interface LedgerFilterInput extends CommonAuditInput {
  entry_type?: string;
  direction?: 'consume' | 'grant' | 'any';
}

export function unwrapEnvelope<T>(response: ApiEnvelope<T> | T): T {
  if (
    response &&
    typeof response === 'object' &&
    'status' in response &&
    'data' in response
  ) {
    const envelope = response as ApiEnvelope<T>;
    if (envelope.status === 'failure') {
      throw new Error(envelope.message || 'QVeris API request failed');
    }
    return envelope.data;
  }
  return response as T;
}

export function normalizeMode(mode: CommonAuditInput['mode']): AuditMode {
  if (mode === 'search') return 'search';
  if (mode === 'export_file' || mode === 'export-file') return 'export_file';
  return 'summary';
}

export function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return DEFAULT_DETAIL_LIMIT;
  return Math.min(Math.floor(limit), MAX_DETAIL_LIMIT);
}

export function resolveDateRange(input: CommonAuditInput): { start_date: string; end_date: string } {
  return {
    start_date: input.start_date || isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    end_date: input.end_date || isoDate(new Date()),
  };
}

export function chooseBucket(input: CommonAuditInput): Bucket {
  if (input.bucket === 'hour' || input.bucket === 'day' || input.bucket === 'week') return input.bucket;
  const { start_date, end_date } = resolveDateRange(input);
  const start = Date.parse(`${start_date}T00:00:00Z`);
  const end = Date.parse(`${end_date}T23:59:59Z`);
  const days = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(1, Math.ceil((end - start) / 86400000))
    : 1;
  if (days <= 2) return 'hour';
  if (days <= 60) return 'day';
  return 'week';
}

export function getUsageItems(response: UsageEventsResponse): UsageEventItem[] {
  return Array.isArray(response.items) ? response.items : [];
}

export function getLedgerItems(response: CreditsLedgerResponse): CreditsLedgerItem[] {
  return Array.isArray(response.items) ? response.items : [];
}

export function usageAmount(row: UsageEventItem): number {
  return firstNumber(
    row.actual_amount_credits,
    row.settled_amount_credits,
    numberFromRecord(row.settlement_result, 'settled_amount_credits'),
    row.requested_amount_credits,
    row.pre_settlement_amount_credits,
  );
}

export function ledgerAmount(row: CreditsLedgerItem): number {
  return toNumber(row.amount_credits);
}

export function matchesUsage(row: UsageEventItem, input: UsageFilterInput): boolean {
  return matchesAmount(usageAmount(row), input) &&
    matchesField(row.execution_id, input.execution_id) &&
    matchesField(row.search_id, input.search_id) &&
    matchesField(row.event_type, input.event_type) &&
    matchesField(row.kind, input.kind) &&
    matchesField(row.charge_outcome, input.charge_outcome) &&
    matchesBoolean(row.success, input.success);
}

export function matchesLedger(row: CreditsLedgerItem, input: LedgerFilterInput): boolean {
  const amount = ledgerAmount(row);
  const direction = input.direction || 'any';
  if (direction === 'consume' && !(amount < 0)) return false;
  if (direction === 'grant' && !(amount > 0)) return false;
  return matchesAmount(Math.abs(amount), input) &&
    matchesField(row.entry_type, input.entry_type);
}

export function pickUsage(row: UsageEventItem): Record<string, unknown> {
  return {
    created_at: row.created_at,
    event_type: row.event_type,
    success: row.success,
    charge_outcome: row.charge_outcome || null,
    target: row.tool_id || row.model || row.query || row.display_target || row.source_ref_id || '',
    execution_id: row.execution_id || null,
    search_id: row.search_id || null,
    billing_summary: row.billing_summary || stringFromRecord(row.pre_settlement_bill, 'summary'),
    requested_amount_credits: row.requested_amount_credits ?? row.pre_settlement_amount_credits ?? null,
    actual_amount_credits: usageAmount(row),
    credits_ledger_entry_id: row.credits_ledger_entry_id || null,
    error_message: row.error_message || null,
  };
}

export function pickLedger(row: CreditsLedgerItem): Record<string, unknown> {
  return {
    created_at: row.created_at,
    entry_type: row.entry_type,
    amount_credits: ledgerAmount(row),
    source_ref_type: row.source_ref_type || null,
    source_ref_id: row.source_ref_id || null,
    description: row.description || '',
    billing_summary: stringFromRecord(row.pre_settlement_bill, 'summary'),
    settled_amount_credits: numberFromRecord(row.settlement_result, 'settled_amount_credits'),
    bucket_deductions: arrayFromRecord(row.settlement_result, 'bucket_deductions'),
  };
}

export function summarizeUsage(
  rows: UsageEventItem[],
  input: UsageFilterInput,
  scannedRecords: number,
  total: number | undefined,
  truncated: boolean,
): Record<string, unknown> {
  const range = resolveDateRange(input);
  const bucket = chooseBucket(input);
  const chargeOutcomes: Record<string, number> = {};
  const buckets: Record<string, Record<string, number>> = {};
  let succeeded = 0;
  let failed = 0;
  let requested = 0;
  let actual = 0;

  for (const row of rows) {
    if (row.success) succeeded += 1;
    else failed += 1;
    const outcome = row.charge_outcome || 'unknown';
    chargeOutcomes[outcome] = (chargeOutcomes[outcome] || 0) + 1;
    requested += firstNumber(row.requested_amount_credits, row.pre_settlement_amount_credits);
    actual += usageAmount(row);
    const key = bucketKey(row.created_at, bucket);
    buckets[key] ||= { events: 0, succeeded: 0, failed: 0, actual_amount_credits: 0 };
    buckets[key].events += 1;
    if (row.success) buckets[key].succeeded += 1;
    else buckets[key].failed += 1;
    buckets[key].actual_amount_credits = round(buckets[key].actual_amount_credits + usageAmount(row));
  }

  return {
    mode: 'summary',
    ...range,
    bucket,
    total_events: rows.length,
    succeeded,
    failed,
    charge_outcomes: chargeOutcomes,
    requested_amount_credits: round(requested),
    actual_amount_credits: round(actual),
    buckets,
    top_charges: rows
      .map((row) => ({ ...pickUsage(row), amount: usageAmount(row) }))
      .filter((row) => Number(row.amount) > 0)
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, DEFAULT_DETAIL_LIMIT),
    scanned_records: scannedRecords,
    matched_records: total,
    truncated,
  };
}

export function summarizeUsageFromServer(
  serverSummary: Record<string, unknown>,
  input: UsageFilterInput,
  scannedRecords: number,
  total: number | undefined,
): Record<string, unknown> {
  const range = resolveDateRange(input);
  const bucket = chooseBucket(input);
  const buckets: Record<string, Record<string, number>> = {};
  const serverBuckets = Array.isArray(serverSummary.buckets) ? serverSummary.buckets : [];
  for (const row of serverBuckets) {
    if (!row || typeof row !== 'object') continue;
    const bucketRow = row as Record<string, unknown>;
    const key = stringValue(bucketRow.bucket_start) || 'unknown';
    buckets[key] = {
      events: numberValue(bucketRow.total_count),
      succeeded: numberValue(bucketRow.success_count),
      failed: numberValue(bucketRow.failure_count),
      actual_amount_credits: round(numberValue(bucketRow.settled_credits)),
    };
  }

  const maxChargeItems = Array.isArray(serverSummary.max_charge_items)
    ? serverSummary.max_charge_items as UsageEventItem[]
    : [];
  return {
    mode: 'summary',
    start_date: dateOnly(serverSummary.start_date) || range.start_date,
    end_date: dateOnly(serverSummary.end_date) || range.end_date,
    bucket: stringValue(serverSummary.bucket) || bucket,
    total_events: numberValue(serverSummary.total_count),
    succeeded: numberValue(serverSummary.success_count),
    failed: numberValue(serverSummary.failure_count),
    charge_outcomes: recordValue(serverSummary.charge_outcome_counts),
    requested_amount_credits: round(numberValue(serverSummary.pre_settlement_credits)),
    actual_amount_credits: round(numberValue(serverSummary.settled_credits)),
    buckets,
    top_charges: maxChargeItems
      .map((row) => ({ ...pickUsage(row), amount: usageAmount(row) }))
      .filter((row) => Number(row.amount) > 0)
      .slice(0, DEFAULT_DETAIL_LIMIT),
    scanned_records: scannedRecords,
    matched_records: total,
    truncated: false,
  };
}

export function summarizeLedger(
  rows: CreditsLedgerItem[],
  input: LedgerFilterInput,
  scannedRecords: number,
  total: number | undefined,
  truncated: boolean,
): Record<string, unknown> {
  const range = resolveDateRange(input);
  const bucket = chooseBucket(input);
  const entryTypes: Record<string, { count: number; amount_credits: number }> = {};
  const buckets: Record<string, Record<string, number>> = {};
  let consumed = 0;
  let granted = 0;
  let net = 0;

  for (const row of rows) {
    const amount = ledgerAmount(row);
    if (amount < 0) consumed += Math.abs(amount);
    if (amount > 0) granted += amount;
    net += amount;
    const type = row.entry_type || 'unknown';
    entryTypes[type] ||= { count: 0, amount_credits: 0 };
    entryTypes[type].count += 1;
    entryTypes[type].amount_credits = round(entryTypes[type].amount_credits + amount);
    const key = bucketKey(row.created_at, bucket);
    buckets[key] ||= { entries: 0, consumed_credits: 0, granted_credits: 0, net_credits: 0 };
    buckets[key].entries += 1;
    if (amount < 0) buckets[key].consumed_credits = round(buckets[key].consumed_credits + Math.abs(amount));
    if (amount > 0) buckets[key].granted_credits = round(buckets[key].granted_credits + amount);
    buckets[key].net_credits = round(buckets[key].net_credits + amount);
  }

  return {
    mode: 'summary',
    ...range,
    bucket,
    total_entries: rows.length,
    consumed_credits: round(consumed),
    granted_credits: round(granted),
    net_credits: round(net),
    entry_types: entryTypes,
    buckets,
    top_debits: rows
      .filter((row) => ledgerAmount(row) < 0)
      .map((row) => pickLedger(row))
      .sort((a, b) => Math.abs(Number(b.amount_credits)) - Math.abs(Number(a.amount_credits)))
      .slice(0, DEFAULT_DETAIL_LIMIT),
    scanned_records: scannedRecords,
    matched_records: total,
    truncated,
  };
}

export function summarizeLedgerFromServer(
  serverSummary: Record<string, unknown>,
  input: LedgerFilterInput,
  scannedRecords: number,
  total: number | undefined,
): Record<string, unknown> {
  const range = resolveDateRange(input);
  const bucket = chooseBucket(input);
  const buckets: Record<string, Record<string, number>> = {};
  const serverBuckets = Array.isArray(serverSummary.buckets) ? serverSummary.buckets : [];
  for (const row of serverBuckets) {
    if (!row || typeof row !== 'object') continue;
    const bucketRow = row as Record<string, unknown>;
    const key = stringValue(bucketRow.bucket_start) || 'unknown';
    buckets[key] = {
      entries: numberValue(bucketRow.entry_count),
      consumed_credits: round(numberValue(bucketRow.consumed_credits)),
      granted_credits: round(numberValue(bucketRow.granted_credits)),
      net_credits: round(numberValue(bucketRow.net_amount_credits)),
    };
  }

  const maxAmountItems = Array.isArray(serverSummary.max_amount_items)
    ? serverSummary.max_amount_items as CreditsLedgerItem[]
    : [];
  return {
    mode: 'summary',
    start_date: dateOnly(serverSummary.start_date) || range.start_date,
    end_date: dateOnly(serverSummary.end_date) || range.end_date,
    bucket: stringValue(serverSummary.bucket) || bucket,
    total_entries: numberValue(serverSummary.total_entries),
    consumed_credits: round(numberValue(serverSummary.consumed_credits)),
    granted_credits: round(numberValue(serverSummary.granted_credits)),
    net_credits: round(numberValue(serverSummary.net_amount_credits)),
    entry_types: {},
    buckets,
    top_debits: maxAmountItems
      .filter((row) => ledgerAmount(row) < 0)
      .map((row) => pickLedger(row))
      .slice(0, DEFAULT_DETAIL_LIMIT),
    scanned_records: scannedRecords,
    matched_records: total,
    truncated: false,
  };
}

export function writeJsonlExport(kind: string, rows: unknown[], metadata: Record<string, unknown>): Record<string, unknown> {
  const dir = join(process.cwd(), '.qveris', 'exports');
  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filePath = join(dir, `${kind}_${timestamp}.jsonl`);
  writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
  return {
    mode: 'export_file',
    file_path: filePath,
    format: 'jsonl',
    record_count: rows.length,
    ...metadata,
  };
}

function matchesAmount(amount: number, input: CommonAuditInput): boolean {
  if (input.min_credits !== undefined && Number.isFinite(input.min_credits) && amount < input.min_credits) return false;
  if (input.max_credits !== undefined && Number.isFinite(input.max_credits) && amount > input.max_credits) return false;
  return true;
}

function matchesField(value: unknown, expected: unknown): boolean {
  if (expected === undefined || expected === null || expected === '') return true;
  return String(value ?? '') === String(expected);
}

function matchesBoolean(value: boolean, expected: boolean | undefined): boolean {
  if (expected === undefined) return true;
  return value === expected;
}

function bucketKey(createdAt: string | undefined, bucket: Bucket): string {
  const date = new Date(createdAt || Date.now());
  if (!Number.isFinite(date.getTime())) return 'unknown';
  if (bucket === 'hour') return `${date.toISOString().slice(0, 13)}:00:00Z`;
  if (bucket === 'week') return isoWeek(date);
  return date.toISOString().slice(0, 10);
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function firstNumber(...values: Array<number | string | null | undefined>): number {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberFromRecord(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const value = record[key];
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringFromRecord(record: Record<string, unknown> | null | undefined, key: string): string {
  if (!record || typeof record !== 'object') return '';
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function arrayFromRecord(record: Record<string, unknown> | null | undefined, key: string): unknown[] {
  if (!record || typeof record !== 'object') return [];
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function dateOnly(value: unknown): string {
  return stringValue(value).slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
