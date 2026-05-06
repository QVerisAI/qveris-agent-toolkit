import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bold, cyan, dim, green, red, yellow } from "./colors.mjs";

export const DEFAULT_DETAIL_LIMIT = 10;
export const MAX_DETAIL_LIMIT = 50;
export const DEFAULT_PAGE_SIZE = 500;
export const MAX_SUMMARY_ROWS = 5000;
export const MAX_SEARCH_SCAN_ROWS = 2000;
export const MAX_EXPORT_ROWS = 50000;

export function resolveMode(rawMode) {
  const mode = String(rawMode || "summary").replace("_", "-");
  if (mode === "export-file") return "export_file";
  if (mode === "export_file") return "export_file";
  if (mode === "search") return "search";
  return "summary";
}

export function clampLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DETAIL_LIMIT;
  return Math.min(parsed, MAX_DETAIL_LIMIT);
}

export function parseBooleanFlag(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
}

export function resolveDateRange(flags = {}) {
  const end = flags.endDate || isoDate(new Date());
  const start = flags.startDate || isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  return { startDate: start, endDate: end };
}

export function chooseBucket(startDate, endDate, requestedBucket) {
  if (["hour", "day", "week"].includes(requestedBucket)) return requestedBucket;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  const days = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)))
    : 1;
  if (days <= 2) return "hour";
  if (days <= 60) return "day";
  return "week";
}

export function buildUsageQuery(flags, { page = 1, pageSize = DEFAULT_PAGE_SIZE, mode } = {}) {
  const { startDate, endDate } = resolveDateRange(flags);
  const query = {
    start_date: startDate,
    end_date: endDate,
    page,
    page_size: pageSize,
  };
  setIf(query, "execution_id", flags.executionId);
  setIf(query, "search_id", flags.searchId);
  setIf(query, "event_type", flags.eventType);
  setIf(query, "kind", flags.kind);
  setIf(query, "charge_outcome", flags.chargeOutcome);
  setIf(query, "min_credits", flags.minCredits);
  setIf(query, "max_credits", flags.maxCredits);
  const success = parseBooleanFlag(flags.success);
  if (success !== undefined) query.success = success;
  if (mode === "summary") {
    query.summary = true;
    setIf(query, "bucket", flags.bucket);
    setIf(query, "limit", flags.limit || DEFAULT_DETAIL_LIMIT);
  }
  return query;
}

export function buildLedgerQuery(flags, { page = 1, pageSize = DEFAULT_PAGE_SIZE, mode } = {}) {
  const { startDate, endDate } = resolveDateRange(flags);
  const query = {
    start_date: startDate,
    end_date: endDate,
    page,
    page_size: pageSize,
  };
  setIf(query, "entry_type", flags.entryType);
  setIf(query, "direction", flags.direction);
  setIf(query, "min_credits", flags.minCredits);
  setIf(query, "max_credits", flags.maxCredits);
  if (mode === "summary") {
    query.summary = true;
    setIf(query, "bucket", flags.bucket);
    setIf(query, "limit", flags.limit || DEFAULT_DETAIL_LIMIT);
  }
  return query;
}

export function extractItems(response) {
  if (!response || typeof response !== "object") return [];
  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.data?.items)) return response.data.items;
  return [];
}

export function extractTotal(response, fallbackCount) {
  const raw = response?.total ?? response?.data?.total;
  return typeof raw === "number" ? raw : fallbackCount;
}

export function matchesUsageFilters(row, flags) {
  const amount = usageAmount(row);
  return matchesAmount(amount, flags) &&
    matchesField(row.execution_id, flags.executionId) &&
    matchesField(row.search_id, flags.searchId) &&
    matchesField(row.event_type, flags.eventType) &&
    matchesField(row.charge_outcome, flags.chargeOutcome) &&
    matchesField(row.kind, flags.kind) &&
    matchesBoolean(row.success, parseBooleanFlag(flags.success));
}

export function matchesLedgerFilters(row, flags) {
  const amount = Math.abs(toNumber(row.amount_credits));
  const direction = flags.direction || "any";
  if (direction === "consume" && !(toNumber(row.amount_credits) < 0)) return false;
  if (direction === "grant" && !(toNumber(row.amount_credits) > 0)) return false;
  return matchesAmount(amount, flags) && matchesField(row.entry_type, flags.entryType);
}

export function usageAmount(row) {
  return firstNumber(
    row?.actual_amount_credits,
    row?.settled_amount_credits,
    row?.settlement_result?.settled_amount_credits,
    row?.requested_amount_credits,
    row?.pre_settlement_amount_credits,
    row?.list_amount_credits,
  );
}

export function ledgerAmount(row) {
  return toNumber(row?.amount_credits);
}

export function buildUsageSummary(rows, { startDate, endDate, bucket }) {
  const summary = {
    start_date: startDate,
    end_date: endDate,
    bucket,
    total_events: rows.length,
    succeeded: 0,
    failed: 0,
    charge_outcomes: {},
    requested_amount_credits: 0,
    actual_amount_credits: 0,
    buckets: {},
    top_charges: [],
  };

  for (const row of rows) {
    if (row.success) summary.succeeded += 1;
    else summary.failed += 1;
    const outcome = row.charge_outcome || "unknown";
    summary.charge_outcomes[outcome] = (summary.charge_outcomes[outcome] || 0) + 1;
    summary.requested_amount_credits += firstNumber(row.requested_amount_credits, row.pre_settlement_amount_credits);
    summary.actual_amount_credits += usageAmount(row);
    const key = bucketKey(row.created_at, bucket);
    if (!summary.buckets[key]) {
      summary.buckets[key] = { events: 0, succeeded: 0, failed: 0, actual_amount_credits: 0 };
    }
    summary.buckets[key].events += 1;
    if (row.success) summary.buckets[key].succeeded += 1;
    else summary.buckets[key].failed += 1;
    summary.buckets[key].actual_amount_credits += usageAmount(row);
  }

  summary.requested_amount_credits = round(summary.requested_amount_credits);
  summary.actual_amount_credits = round(summary.actual_amount_credits);
  for (const value of Object.values(summary.buckets)) {
    value.actual_amount_credits = round(value.actual_amount_credits);
  }
  summary.top_charges = rows
    .map((row) => ({ ...pickUsageRow(row), amount: usageAmount(row) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, DEFAULT_DETAIL_LIMIT);
  return summary;
}

export function buildUsageSummaryFromServer(serverSummary, { startDate, endDate, bucket }) {
  const buckets = {};
  for (const row of Array.isArray(serverSummary?.buckets) ? serverSummary.buckets : []) {
    const key = row.bucket_start || "unknown";
    buckets[key] = {
      events: numberValue(row.total_count),
      succeeded: numberValue(row.success_count),
      failed: numberValue(row.failure_count),
      actual_amount_credits: round(row.settled_credits),
    };
  }
  return {
    start_date: dateOnly(serverSummary?.start_date) || startDate,
    end_date: dateOnly(serverSummary?.end_date) || endDate,
    bucket: serverSummary?.bucket || bucket,
    total_events: numberValue(serverSummary?.total_count),
    succeeded: numberValue(serverSummary?.success_count),
    failed: numberValue(serverSummary?.failure_count),
    charge_outcomes: serverSummary?.charge_outcome_counts || {},
    requested_amount_credits: round(serverSummary?.pre_settlement_credits),
    actual_amount_credits: round(serverSummary?.settled_credits),
    buckets,
    top_charges: (Array.isArray(serverSummary?.max_charge_items) ? serverSummary.max_charge_items : [])
      .map((row) => ({ ...pickUsageRow(row), amount: usageAmount(row) }))
      .slice(0, DEFAULT_DETAIL_LIMIT),
  };
}

export function buildLedgerSummary(rows, { startDate, endDate, bucket }) {
  const summary = {
    start_date: startDate,
    end_date: endDate,
    bucket,
    total_entries: rows.length,
    consumed_credits: 0,
    granted_credits: 0,
    net_credits: 0,
    entry_types: {},
    buckets: {},
    top_debits: [],
  };

  for (const row of rows) {
    const amount = ledgerAmount(row);
    if (amount < 0) summary.consumed_credits += Math.abs(amount);
    if (amount > 0) summary.granted_credits += amount;
    summary.net_credits += amount;
    if (!summary.entry_types[row.entry_type || "unknown"]) {
      summary.entry_types[row.entry_type || "unknown"] = { count: 0, amount_credits: 0 };
    }
    summary.entry_types[row.entry_type || "unknown"].count += 1;
    summary.entry_types[row.entry_type || "unknown"].amount_credits += amount;
    const key = bucketKey(row.created_at, bucket);
    if (!summary.buckets[key]) {
      summary.buckets[key] = { entries: 0, consumed_credits: 0, granted_credits: 0, net_credits: 0 };
    }
    summary.buckets[key].entries += 1;
    if (amount < 0) summary.buckets[key].consumed_credits += Math.abs(amount);
    if (amount > 0) summary.buckets[key].granted_credits += amount;
    summary.buckets[key].net_credits += amount;
  }

  summary.consumed_credits = round(summary.consumed_credits);
  summary.granted_credits = round(summary.granted_credits);
  summary.net_credits = round(summary.net_credits);
  for (const value of Object.values(summary.entry_types)) {
    value.amount_credits = round(value.amount_credits);
  }
  for (const value of Object.values(summary.buckets)) {
    value.consumed_credits = round(value.consumed_credits);
    value.granted_credits = round(value.granted_credits);
    value.net_credits = round(value.net_credits);
  }
  summary.top_debits = rows
    .filter((row) => ledgerAmount(row) < 0)
    .map((row) => pickLedgerRow(row))
    .sort((a, b) => Math.abs(b.amount_credits) - Math.abs(a.amount_credits))
    .slice(0, DEFAULT_DETAIL_LIMIT);
  return summary;
}

export function buildLedgerSummaryFromServer(serverSummary, { startDate, endDate, bucket }) {
  const buckets = {};
  for (const row of Array.isArray(serverSummary?.buckets) ? serverSummary.buckets : []) {
    const key = row.bucket_start || "unknown";
    buckets[key] = {
      entries: numberValue(row.entry_count),
      consumed_credits: round(row.consumed_credits),
      granted_credits: round(row.granted_credits),
      net_credits: round(row.net_amount_credits),
    };
  }
  return {
    start_date: dateOnly(serverSummary?.start_date) || startDate,
    end_date: dateOnly(serverSummary?.end_date) || endDate,
    bucket: serverSummary?.bucket || bucket,
    total_entries: numberValue(serverSummary?.total_entries),
    consumed_credits: round(serverSummary?.consumed_credits),
    granted_credits: round(serverSummary?.granted_credits),
    net_credits: round(serverSummary?.net_amount_credits),
    entry_types: {},
    buckets,
    top_debits: (Array.isArray(serverSummary?.max_amount_items) ? serverSummary.max_amount_items : [])
      .filter((row) => ledgerAmount(row) < 0)
      .map((row) => pickLedgerRow(row))
      .slice(0, DEFAULT_DETAIL_LIMIT),
  };
}

export function pickUsageRow(row) {
  return {
    created_at: row.created_at,
    event_type: row.event_type,
    success: row.success,
    charge_outcome: row.charge_outcome,
    target: row.tool_id || row.model || row.query || row.display_target || row.source_ref_id || "",
    execution_id: row.execution_id || null,
    search_id: row.search_id || null,
    billing_summary: row.billing_summary || row.pre_settlement_bill?.summary || "",
    requested_amount_credits: row.requested_amount_credits ?? row.pre_settlement_amount_credits ?? null,
    actual_amount_credits: usageAmount(row),
    credits_ledger_entry_id: row.credits_ledger_entry_id || null,
    error_message: row.error_message || null,
  };
}

export function pickLedgerRow(row) {
  const settlement = row.settlement_result && typeof row.settlement_result === "object" ? row.settlement_result : {};
  const preBill = row.pre_settlement_bill && typeof row.pre_settlement_bill === "object" ? row.pre_settlement_bill : {};
  return {
    created_at: row.created_at,
    entry_type: row.entry_type,
    amount_credits: ledgerAmount(row),
    source_ref_type: row.source_ref_type || null,
    source_ref_id: row.source_ref_id || null,
    description: row.description || "",
    billing_summary: preBill.summary || "",
    settled_amount_credits: settlement.settled_amount_credits ?? null,
    bucket_deductions: Array.isArray(settlement.bucket_deductions) ? settlement.bucket_deductions : [],
  };
}

export function formatUsageSummary(summary, { scannedRows, total, partial }) {
  const lines = [];
  lines.push(`\n  ${bold("Usage History Summary")}`);
  lines.push(`  ${dim("Range:")} ${summary.start_date} to ${summary.end_date}  ${dim("bucket:")} ${summary.bucket}`);
  lines.push(`  ${dim("Events:")} ${bold(String(summary.total_events))}  ${green(String(summary.succeeded))} succeeded  ${summary.failed ? red(String(summary.failed)) : "0"} failed`);
  lines.push(`  ${dim("Credits:")} requested ${yellow(String(summary.requested_amount_credits))}  actual ${yellow(String(summary.actual_amount_credits))}`);
  lines.push(`  ${dim("Charge outcomes:")} ${formatCounts(summary.charge_outcomes) || "none"}`);
  if (partial) {
    lines.push(`  ${yellow("Partial summary:")} scanned ${scannedRows} of ${total ?? "unknown"} matching rows. Use --mode export-file for full analysis.`);
  }
  appendBuckets(lines, summary.buckets, (value) => `${value.events} events, ${value.actual_amount_credits} credits`);
  appendUsageRows(lines, summary.top_charges, "Top charges");
  return lines.join("\n");
}

export function formatUsageRows(rows, { total, partial }) {
  const lines = [];
  lines.push(`\n  ${bold("Usage History Results")}`);
  lines.push(`  ${dim("Shown:")} ${rows.length}${total !== undefined ? ` of ${total}` : ""}${partial ? `  ${yellow("(truncated)")}` : ""}`);
  appendUsageRows(lines, rows.map(pickUsageRow), "Records");
  if (partial) lines.push(`  ${dim("Use --mode export-file for full matching records.")}`);
  return lines.join("\n");
}

export function formatLedgerSummary(summary, { scannedRows, total, partial }) {
  const lines = [];
  lines.push(`\n  ${bold("Credits Ledger Summary")}`);
  lines.push(`  ${dim("Range:")} ${summary.start_date} to ${summary.end_date}  ${dim("bucket:")} ${summary.bucket}`);
  lines.push(`  ${dim("Entries:")} ${bold(String(summary.total_entries))}`);
  lines.push(`  ${dim("Credits:")} consumed ${yellow(String(summary.consumed_credits))}  granted ${green(String(summary.granted_credits))}  net ${yellow(String(summary.net_credits))}`);
  lines.push(`  ${dim("Entry types:")} ${formatEntryTypes(summary.entry_types) || "none"}`);
  if (partial) {
    lines.push(`  ${yellow("Partial summary:")} scanned ${scannedRows} of ${total ?? "unknown"} matching rows. Use --mode export-file for full analysis.`);
  }
  appendBuckets(lines, summary.buckets, (value) => `${value.entries} entries, net ${value.net_credits}`);
  appendLedgerRows(lines, summary.top_debits, "Top debits");
  return lines.join("\n");
}

export function formatLedgerRows(rows, { total, partial }) {
  const lines = [];
  lines.push(`\n  ${bold("Credits Ledger Results")}`);
  lines.push(`  ${dim("Shown:")} ${rows.length}${total !== undefined ? ` of ${total}` : ""}${partial ? `  ${yellow("(truncated)")}` : ""}`);
  appendLedgerRows(lines, rows.map(pickLedgerRow), "Records");
  if (partial) lines.push(`  ${dim("Use --mode export-file for full matching records.")}`);
  return lines.join("\n");
}

export function writeJsonlExport(kind, rows, metadata) {
  const dir = join(process.cwd(), ".qveris", "exports");
  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const path = join(dir, `${kind}_${timestamp}.jsonl`);
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  writeFileSync(path, body, "utf-8");
  return {
    mode: "export_file",
    file_path: path,
    format: "jsonl",
    record_count: rows.length,
    ...metadata,
  };
}

export function formatExportMetadata(metadata) {
  return [
    `\n  ${bold("Export written")}`,
    `  ${dim("File:")} ${cyan(metadata.file_path)}`,
    `  ${dim("Records:")} ${metadata.record_count}`,
    `  ${dim("Format:")} ${metadata.format}`,
    `  ${dim("Read in chunks with rg, jq, or a script; raw rows were not printed to protect context.")}`,
  ].join("\n");
}

function appendBuckets(lines, buckets, render) {
  const entries = Object.entries(buckets || {}).sort(([a], [b]) => a.localeCompare(b)).slice(0, 12);
  if (entries.length === 0) return;
  lines.push("");
  lines.push(`  ${bold("Buckets:")}`);
  for (const [key, value] of entries) {
    lines.push(`    ${dim(key)}  ${render(value)}`);
  }
}

function appendUsageRows(lines, rows, title) {
  if (!rows.length) return;
  lines.push("");
  lines.push(`  ${bold(title + ":")}`);
  for (const row of rows) {
    const status = row.success ? green("succeeded") : red("failed");
    lines.push(`    ${dim(formatDateTime(row.created_at))}  ${status}  ${yellow(String(row.actual_amount_credits ?? row.amount ?? 0))} cr  ${row.charge_outcome || "unknown"}  ${row.target || ""}`);
    if (row.execution_id) lines.push(`      ${dim("execution:")} ${row.execution_id}`);
    if (row.billing_summary) lines.push(`      ${dim(row.billing_summary)}`);
    if (row.error_message) lines.push(`      ${red(row.error_message)}`);
  }
}

function appendLedgerRows(lines, rows, title) {
  if (!rows.length) return;
  lines.push("");
  lines.push(`  ${bold(title + ":")}`);
  for (const row of rows) {
    const amount = row.amount_credits;
    const amountText = amount < 0 ? red(String(amount)) : green(String(amount));
    lines.push(`    ${dim(formatDateTime(row.created_at))}  ${amountText} cr  ${row.entry_type || "unknown"}  ${row.source_ref_id || ""}`);
    if (row.billing_summary) lines.push(`      ${dim(row.billing_summary)}`);
    if (row.bucket_deductions?.length) {
      lines.push(`      ${dim("buckets:")} ${row.bucket_deductions.map(formatBucketDeduction).join(", ")}`);
    }
  }
}

function formatBucketDeduction(item) {
  if (!item || typeof item !== "object") return "";
  return `${item.bucket_type || item.bucket || "bucket"}:${item.amount ?? "?"}`;
}

function formatCounts(counts) {
  return Object.entries(counts || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatEntryTypes(entryTypes) {
  return Object.entries(entryTypes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value.count}/${round(value.amount_credits)}cr`)
    .join(", ");
}

function bucketKey(createdAt, bucket) {
  const date = new Date(createdAt || Date.now());
  if (!Number.isFinite(date.getTime())) return "unknown";
  if (bucket === "hour") return date.toISOString().slice(0, 13) + ":00:00Z";
  if (bucket === "week") return isoWeek(date);
  return date.toISOString().slice(0, 10);
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").slice(0, 19) : String(value);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== 0 || value === 0 || value === "0") return number;
  }
  return 0;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function matchesAmount(amount, flags) {
  const min = flags.minCredits === undefined ? undefined : Number(flags.minCredits);
  const max = flags.maxCredits === undefined ? undefined : Number(flags.maxCredits);
  if (Number.isFinite(min) && amount < min) return false;
  if (Number.isFinite(max) && amount > max) return false;
  return true;
}

function matchesField(value, expected) {
  if (expected === undefined || expected === null || expected === "") return true;
  return String(value ?? "") === String(expected);
}

function matchesBoolean(value, expected) {
  if (expected === undefined) return true;
  return Boolean(value) === expected;
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function setIf(target, key, value) {
  if (value !== undefined && value !== null && value !== "") target[key] = value;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}
