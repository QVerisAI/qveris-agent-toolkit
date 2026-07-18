import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeLegacyArgs } from "../src/compat/aliases.mjs";
import { resolveApiKey } from "../src/client/auth.mjs";
import { getSiteUrl, normalizeBaseUrl, resolveBaseUrl } from "../src/config/endpoint.mjs";
import {
  buildLedgerQuery,
  buildLedgerSummary,
  buildUsageQuery,
  buildUsageSummary,
  clampLimit,
  matchesLedgerFilters,
  matchesUsageFilters,
  resolveMode,
} from "../src/output/audit.mjs";
import { generateSnippet } from "../src/output/codegen.mjs";
import { resolveParams } from "../src/utils/params.mjs";

function withTempConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-core-"));
  const previous = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    QVERIS_API_KEY: process.env.QVERIS_API_KEY,
    QVERIS_BASE_URL: process.env.QVERIS_BASE_URL,
    QVERIS_REGION: process.env.QVERIS_REGION,
  };
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  delete process.env.QVERIS_REGION;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    });
}

test("endpoint resolution uses flag, environment, then default without key or region inference", async () => {
  await withTempConfig(() => {
    assert.equal(resolveApiKey("sk-flag").trim(), "sk-flag");
    assert.throws(() => resolveApiKey("YOUR_QVERIS_API_KEY"), /placeholder/);
    assert.throws(
      () => resolveApiKey(12345),
      (error) => error?.code === "AUTH_MISSING_KEY" && /must be a string/.test(error.message),
    );
    process.env.QVERIS_REGION = "cn";
    assert.deepEqual(resolveBaseUrl({ apiKey: "sk-cn-test" }), {
      baseUrl: "https://qveris.ai/api/v1",
      source: "default",
    });

    process.env.QVERIS_BASE_URL = "";
    assert.throws(() => resolveBaseUrl(), /non-empty HTTP\(S\) URL/);

    process.env.QVERIS_BASE_URL = "https://env.test/api/v1///";
    assert.deepEqual(resolveBaseUrl(), {
      baseUrl: "https://env.test/api/v1",
      source: "env (QVERIS_BASE_URL)",
    });
    assert.deepEqual(resolveBaseUrl({ baseUrlFlag: "http://localhost:3000/api/v1/" }), {
      baseUrl: "http://localhost:3000/api/v1",
      source: "flag",
    });
  });
});

test("endpoint normalization rejects unsafe or invalid base URLs", () => {
  assert.equal(normalizeBaseUrl(" https://unit.test/api/v1/ "), "https://unit.test/api/v1");
  assert.throws(() => normalizeBaseUrl("not-a-url"), /Invalid API base URL/);
  assert.throws(() => normalizeBaseUrl("ftp://unit.test/api/v1"), /HTTP\(S\)/);
  assert.throws(() => normalizeBaseUrl("https:/unit.test/api/v1"), /valid HTTP\(S\)/);
  assert.throws(() => normalizeBaseUrl("https:unit.test/api/v1"), /valid HTTP\(S\)/);
  assert.throws(() => normalizeBaseUrl("https:///unit.test/api/v1"), /valid HTTP\(S\)/);
  assert.throws(() => normalizeBaseUrl("https://unit.test\\@other.test/api/v1"), /valid HTTP\(S\)/);
  assert.throws(() => normalizeBaseUrl("https://user:secret@unit.test/api/v1"), /without credentials/);
  assert.throws(() => normalizeBaseUrl("https://unit.test/api/v1?target=other"), /query parameters/);
  assert.throws(() => normalizeBaseUrl("https://unit.test/api/v1?"), /query parameters/);
  assert.throws(() => normalizeBaseUrl("https://unit.test/api/v1#"), /fragments/);
});

test("account site resolution preserves public boundaries and custom endpoint origins", () => {
  assert.equal(getSiteUrl("https://qveris.ai/api/v1"), "https://qveris.ai");
  assert.equal(getSiteUrl("https://api.qveris.ai/api/v1"), "https://qveris.ai");
  assert.equal(getSiteUrl("https://qveris.cn/api/v1"), "https://qveris.cn");
  assert.equal(getSiteUrl("https://api.qveris.cn/api/v1"), "https://qveris.cn");
  assert.equal(getSiteUrl("https://enterprise.example:8443/api/v1"), "https://enterprise.example:8443");
});

test("legacy command and flag aliases normalize without changing usage search-id", () => {
  assert.deepEqual(normalizeLegacyArgs(["search", "weather"]).args, ["discover", "weather"]);
  assert.deepEqual(normalizeLegacyArgs(["execute", "1", "--search-id", "s"]).args, [
    "call",
    "1",
    "--discovery-id",
    "s",
  ]);
  assert.deepEqual(normalizeLegacyArgs(["usage", "--search-id", "s"]).args, ["usage", "--search-id", "s"]);
});

test("parameter resolution supports inline JSON, files, defaults, and invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-params-"));
  try {
    const paramsFile = join(dir, "params.json");
    writeFileSync(paramsFile, '{"symbol":"AAPL"}\n');
    assert.deepEqual(resolveParams(), {});
    assert.deepEqual(resolveParams("{}"), {});
    assert.deepEqual(resolveParams('{"city":"London"}'), { city: "London" });
    assert.deepEqual(resolveParams(`@${paramsFile}`), { symbol: "AAPL" });
    assert.throws(() => resolveParams("{bad"), /Expected property name|JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage audit query, filtering, and summary cover core fields", () => {
  const flags = {
    startDate: "2026-05-01",
    endDate: "2026-05-02",
    executionId: "exec-1",
    searchId: "search-1",
    success: "true",
    chargeOutcome: "charged",
    minCredits: "2",
    maxCredits: "10",
    bucket: "hour",
    limit: "7",
  };
  assert.equal(resolveMode("export-file"), "export_file");
  assert.equal(clampLimit("999"), 50);
  assert.deepEqual(buildUsageQuery(flags, { page: 2, pageSize: 25, mode: "summary" }), {
    start_date: "2026-05-01",
    end_date: "2026-05-02",
    page: 2,
    page_size: 25,
    execution_id: "exec-1",
    search_id: "search-1",
    charge_outcome: "charged",
    min_credits: "2",
    max_credits: "10",
    success: true,
    summary: true,
    bucket: "hour",
    limit: "7",
  });

  const row = {
    created_at: "2026-05-01T01:20:00Z",
    event_type: "tool_execute",
    kind: "call",
    success: true,
    charge_outcome: "charged",
    execution_id: "exec-1",
    search_id: "search-1",
    actual_amount_credits: 5,
  };
  assert.equal(matchesUsageFilters(row, flags), true);
  const summary = buildUsageSummary([row], { startDate: "2026-05-01", endDate: "2026-05-02", bucket: "hour" });
  assert.equal(summary.total_events, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.actual_amount_credits, 5);
  assert.equal(summary.charge_outcomes.charged, 1);
});

test("ledger query, filtering, and summary cover consume/grant accounting", () => {
  const flags = {
    startDate: "2026-05-01",
    endDate: "2026-05-02",
    entryType: "consume_tool_execute",
    direction: "consume",
    minCredits: "2",
    maxCredits: "10",
    bucket: "day",
    limit: "5",
  };
  assert.deepEqual(buildLedgerQuery(flags, { page: 1, pageSize: 25, mode: "summary" }), {
    start_date: "2026-05-01",
    end_date: "2026-05-02",
    page: 1,
    page_size: 25,
    entry_type: "consume_tool_execute",
    direction: "consume",
    min_credits: "2",
    max_credits: "10",
    summary: true,
    bucket: "day",
    limit: "5",
  });

  const rows = [
    { created_at: "2026-05-01T00:00:00Z", entry_type: "consume_tool_execute", amount_credits: -5 },
    { created_at: "2026-05-01T00:10:00Z", entry_type: "grant_welcome", amount_credits: 10 },
  ];
  assert.equal(matchesLedgerFilters(rows[0], flags), true);
  assert.equal(matchesLedgerFilters(rows[1], flags), false);
  const summary = buildLedgerSummary(rows, { startDate: "2026-05-01", endDate: "2026-05-02", bucket: "day" });
  assert.equal(summary.total_entries, 2);
  assert.equal(summary.consumed_credits, 5);
  assert.equal(summary.granted_credits, 10);
  assert.equal(summary.net_credits, 5);
});

test("code generation covers curl, JavaScript, Python, and unsupported languages", async () => {
  await withTempConfig(() => {
    process.env.QVERIS_BASE_URL = "https://env.test/api/v1";
    const input = {
      baseUrl: "https://flag.test/api/v1/",
      toolId: "weather.tool.v1",
      discoveryId: "search-1",
      parameters: { city: "London" },
      maxResponseSize: 4096,
    };

    assert.match(generateSnippet("curl", input), /https:\/\/flag\.test\/api\/v1\/tools\/execute/);
    assert.match(generateSnippet("js", input), /https:\/\/flag\.test\/api\/v1\/tools\/execute/);
    assert.match(generateSnippet("python", input), /https:\/\/flag\.test\/api\/v1\/tools\/execute/);
    assert.match(generateSnippet("ruby", input), /Unsupported language/);
  });
});
