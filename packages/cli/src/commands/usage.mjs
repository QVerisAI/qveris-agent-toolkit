import { resolveApiKey } from "../client/auth.mjs";
import { getUsageHistory, unwrapApiResponse } from "../client/api.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import {
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  MAX_SEARCH_SCAN_ROWS,
  MAX_SUMMARY_ROWS,
  buildUsageQuery,
  buildUsageSummary,
  buildUsageSummaryFromServer,
  chooseBucket,
  clampLimit,
  extractItems,
  extractTotal,
  formatExportMetadata,
  formatUsageRows,
  formatUsageSummary,
  matchesUsageFilters,
  pickUsageRow,
  resolveDateRange,
  resolveMode,
  writeJsonlExport,
} from "../output/audit.mjs";

export async function runUsage(flags) {
  const apiKey = resolveApiKey(flags.apiKey);
  const mode = resolveMode(flags.mode);
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const limit = clampLimit(flags.limit);
  const { startDate, endDate } = resolveDateRange(flags);
  const bucket = chooseBucket(startDate, endDate, flags.bucket);

  const spinner = flags.json ? { stop() {} } : createSpinner("Querying usage history...");

  try {
    if (mode === "search") {
      const { rows, total, partial } = await collectUsageRows({
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
        items: rows.map(pickUsageRow),
      };
      if (flags.json) outputJson(payload);
      else console.log(formatUsageRows(rows, { total, partial }));
      return;
    }

    if (mode === "export_file") {
      const { rows, total, partial } = await collectUsageRows({
        apiKey,
        flags,
        timeoutMs,
        limit: MAX_EXPORT_ROWS,
        maxRows: MAX_EXPORT_ROWS,
        stopWhenLimitReached: false,
      });
      spinner.stop();
      const metadata = writeJsonlExport("usage_history", rows, {
        start_date: startDate,
        end_date: endDate,
        matched_records: total,
        truncated: partial,
        filters: usageFilters(flags),
      });
      if (flags.json) outputJson(metadata);
      else console.log(formatExportMetadata(metadata));
      return;
    }

    const summaryResponse = unwrapApiResponse(await getUsageHistory({
      apiKey,
      baseUrl: flags.baseUrl,
      query: buildUsageQuery(flags, {
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
      const summary = buildUsageSummaryFromServer(summaryResponse.summary, { startDate, endDate, bucket });
      if (flags.json) {
        outputJson({
          mode,
          summary,
          scanned_records: rows.length,
          matched_records: total,
          truncated: false,
        });
      } else {
        console.log(formatUsageSummary(summary, { scannedRows: rows.length, total, partial: false }));
      }
      return;
    }

    const { rows, total, partial, scannedRows } = await collectUsageRows({
      apiKey,
      flags,
      timeoutMs,
      limit: MAX_SUMMARY_ROWS,
      maxRows: MAX_SUMMARY_ROWS,
      stopWhenLimitReached: false,
    });
    spinner.stop();
    const summary = buildUsageSummary(rows, { startDate, endDate, bucket });
    if (flags.json) {
      outputJson({
        mode,
        summary,
        scanned_records: scannedRows,
        matched_records: total,
        truncated: partial,
      });
    } else {
      console.log(formatUsageSummary(summary, { scannedRows, total, partial }));
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

async function collectUsageRows({ apiKey, flags, timeoutMs, limit, maxRows, stopWhenLimitReached }) {
  const rows = [];
  let page = 1;
  let total;
  let scannedRows = 0;
  let partial = false;

  while (rows.length < limit && scannedRows < maxRows) {
    const query = buildUsageQuery(flags, { page, pageSize: Math.min(DEFAULT_PAGE_SIZE, maxRows - scannedRows) });
    const response = unwrapApiResponse(await getUsageHistory({
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
      if (!matchesUsageFilters(item, flags)) continue;
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

function usageFilters(flags) {
  return {
    execution_id: flags.executionId,
    search_id: flags.searchId,
    event_type: flags.eventType,
    kind: flags.kind,
    success: flags.success,
    charge_outcome: flags.chargeOutcome,
    min_credits: flags.minCredits,
    max_credits: flags.maxCredits,
  };
}
