import { resolveApiKey } from "../client/auth.mjs";
import { getCreditsLedger, unwrapApiResponse } from "../client/api.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import {
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  MAX_SEARCH_SCAN_ROWS,
  MAX_SUMMARY_ROWS,
  buildLedgerQuery,
  buildLedgerSummary,
  buildLedgerSummaryFromServer,
  chooseBucket,
  clampLimit,
  extractItems,
  extractTotal,
  formatExportMetadata,
  formatLedgerRows,
  formatLedgerSummary,
  matchesLedgerFilters,
  pickLedgerRow,
  resolveDateRange,
  resolveMode,
  writeJsonlExport,
} from "../output/audit.mjs";

export async function runLedger(flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const mode = resolveMode(flags.mode);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const limit = clampLimit(flags.limit);
  const { startDate, endDate } = resolveDateRange(flags);
  const bucket = chooseBucket(startDate, endDate, flags.bucket);

  const spinner = flags.json ? { stop() {} } : createSpinner("Querying credits ledger...");

  try {
    if (mode === "search") {
      const { rows, total, partial } = await collectLedgerRows({
        apiKey,
        flags,
        timeoutMs,
        limit,
        maxRows: MAX_SEARCH_SCAN_ROWS,
        stopWhenLimitReached: true,
      });
      spinner.stop();
      const payload = {
        mode,
        start_date: startDate,
        end_date: endDate,
        shown_records: rows.length,
        matched_records: total,
        truncated: partial,
        items: rows.map(pickLedgerRow),
      };
      if (flags.json) outputJson(payload);
      else console.log(formatLedgerRows(rows, { total, partial }));
      return;
    }

    if (mode === "export_file") {
      const { rows, total, partial } = await collectLedgerRows({
        apiKey,
        flags,
        timeoutMs,
        limit: MAX_EXPORT_ROWS,
        maxRows: MAX_EXPORT_ROWS,
        stopWhenLimitReached: false,
      });
      spinner.stop();
      const metadata = writeJsonlExport("credits_ledger", rows, {
        start_date: startDate,
        end_date: endDate,
        matched_records: total,
        truncated: partial,
        filters: ledgerFilters(flags),
      });
      if (flags.json) outputJson(metadata);
      else console.log(formatExportMetadata(metadata));
      return;
    }

    const summaryResponse = unwrapApiResponse(await getCreditsLedger({
      apiKey,
      baseUrl: flags.baseUrl,
      query: buildLedgerQuery(flags, {
        page: 1,
        pageSize: limit,
        mode: "summary",
      }),
      timeoutMs,
    }));
    if (summaryResponse?.summary) {
      spinner.stop();
      const rows = extractItems(summaryResponse);
      const total = extractTotal(summaryResponse, rows.length);
      const summary = buildLedgerSummaryFromServer(summaryResponse.summary, { startDate, endDate, bucket });
      if (flags.json) {
        outputJson({
          mode,
          summary,
          scanned_records: rows.length,
          matched_records: total,
          truncated: false,
        });
      } else {
        console.log(formatLedgerSummary(summary, { scannedRows: rows.length, total, partial: false }));
      }
      return;
    }

    const { rows, total, partial, scannedRows } = await collectLedgerRows({
      apiKey,
      flags,
      timeoutMs,
      limit: MAX_SUMMARY_ROWS,
      maxRows: MAX_SUMMARY_ROWS,
      stopWhenLimitReached: false,
    });
    spinner.stop();
    const summary = buildLedgerSummary(rows, { startDate, endDate, bucket });
    if (flags.json) {
      outputJson({
        mode,
        summary,
        scanned_records: scannedRows,
        matched_records: total,
        truncated: partial,
      });
    } else {
      console.log(formatLedgerSummary(summary, { scannedRows, total, partial }));
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

async function collectLedgerRows({ apiKey, flags, timeoutMs, limit, maxRows, stopWhenLimitReached }) {
  const rows = [];
  let page = 1;
  let total;
  let scannedRows = 0;
  let partial = false;

  while (rows.length < limit && scannedRows < maxRows) {
    const query = buildLedgerQuery(flags, { page, pageSize: Math.min(DEFAULT_PAGE_SIZE, maxRows - scannedRows) });
    const response = unwrapApiResponse(await getCreditsLedger({
      apiKey,
      baseUrl: flags.baseUrl,
      query,
      timeoutMs,
    }));
    const items = extractItems(response);
    if (total === undefined) total = extractTotal(response, undefined);
    if (items.length === 0) break;
    scannedRows += items.length;
    for (const item of items) {
      if (!matchesLedgerFilters(item, flags)) continue;
      rows.push(item);
      if (stopWhenLimitReached && rows.length >= limit) break;
    }
    if (stopWhenLimitReached && rows.length >= limit) {
      partial = Boolean(total && total > scannedRows);
      break;
    }
    if (total !== undefined && scannedRows >= total) break;
    if (items.length < DEFAULT_PAGE_SIZE) break;
    page += 1;
  }

  if (total !== undefined && scannedRows < total) partial = true;
  if (scannedRows >= maxRows && (total === undefined || scannedRows < total)) partial = true;

  return { rows: rows.slice(0, limit), total, partial, scannedRows };
}

function ledgerFilters(flags) {
  return {
    entry_type: flags.entryType,
    direction: flags.direction,
    min_credits: flags.minCredits,
    max_credits: flags.maxCredits,
  };
}
