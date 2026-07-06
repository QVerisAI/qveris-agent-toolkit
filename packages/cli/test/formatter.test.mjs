import assert from "node:assert/strict";
import test from "node:test";

import { formatDiscoverResult, formatInspectResult } from "../src/output/formatter.mjs";

function discoverResultWith(categories) {
  return {
    search_id: "s-1",
    total: 1,
    results: [
      {
        tool_id: "provider.tool.retrieve.v1.abc123",
        name: "Sample Tool",
        description: "A sample tool.",
        categories,
      },
    ],
  };
}

test("formatDiscoverResult renders object categories as names, not [object Object]", () => {
  const output = formatDiscoverResult(
    discoverResultWith([
      { slug: "finance", name: "finance", description: "" },
      { slug: "market_data", name: "Market Data", description: "Market Data related tools and APIs." },
      { slug: "slug-only", name: "", description: "" },
    ]),
  );
  assert.ok(!output.includes("[object Object]"));
  assert.ok(output.includes("tags: finance, Market Data, slug-only"));
});

test("formatDiscoverResult renders i18n object names via their string values", () => {
  const output = formatDiscoverResult(
    discoverResultWith([
      { slug: "fx", name: { en: "Foreign Exchange", zh: "外汇" } },
      { slug: "rates", name: { zh: "利率" } },
      { slug: "crypto-fallback", name: {} },
    ]),
  );
  assert.ok(!output.includes("[object Object]"));
  assert.ok(output.includes("tags: Foreign Exchange, 利率, crypto-fallback"));
});

test("formatDiscoverResult still renders string categories", () => {
  const output = formatDiscoverResult(discoverResultWith(["finance", "market-data"]));
  assert.ok(output.includes("tags: finance, market-data"));
});

test("formatDiscoverResult dedupes categories case-insensitively and skips empties", () => {
  const output = formatDiscoverResult(
    discoverResultWith(["Finance", { slug: "finance", name: "finance" }, "", null, "  "]),
  );
  assert.ok(output.includes("tags: Finance\n"));
});

test("formatDiscoverResult omits tags line when categories are missing or empty", () => {
  for (const categories of [undefined, [], "not-an-array"]) {
    const output = formatDiscoverResult(discoverResultWith(categories));
    assert.ok(!output.includes("tags:"));
  }
});

test("formatInspectResult renders object categories as names", () => {
  const output = formatInspectResult([
    {
      tool_id: "provider.tool.retrieve.v1.abc123",
      name: "Sample Tool",
      categories: [
        { slug: "market_data", name: "Market Data" },
        "forex",
      ],
    },
  ]);
  assert.ok(!output.includes("[object Object]"));
  assert.ok(output.includes("Categories: Market Data, forex"));
});
