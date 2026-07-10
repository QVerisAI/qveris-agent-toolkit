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

function discoverResultWithTool(tool) {
  return {
    search_id: "s-1",
    total: 1,
    results: [
      {
        tool_id: "provider.tool.retrieve.v1.abc123",
        name: "Sample Tool",
        description: "A sample tool.",
        ...tool,
      },
    ],
  };
}

test("formatDiscoverResult renders why_recommended as a why line", () => {
  const output = formatDiscoverResult(
    discoverResultWithTool({
      why_recommended: "Recommended because it matched both semantic and keyword relevance signals.",
    }),
  );
  assert.ok(output.includes("why: Recommended because it matched both semantic and keyword relevance signals."));
});

test("formatDiscoverResult truncates long why_recommended text", () => {
  const output = formatDiscoverResult(discoverResultWithTool({ why_recommended: "x".repeat(200) }));
  assert.ok(output.includes(`why: ${"x".repeat(160)}...`));
  assert.ok(!output.includes("x".repeat(161)));
});

test("formatDiscoverResult omits why line when why_recommended is missing or empty", () => {
  for (const why_recommended of [undefined, "", null]) {
    const output = formatDiscoverResult(discoverResultWithTool({ why_recommended }));
    assert.ok(!output.includes("why:"));
  }
});

test("formatInspectResult renders object categories as names", () => {
  const output = formatInspectResult([
    {
      tool_id: "provider.tool.retrieve.v1.abc123",
      name: "Sample Tool",
      categories: [{ slug: "market_data", name: "Market Data" }, "forex"],
    },
  ]);
  assert.ok(!output.includes("[object Object]"));
  assert.ok(output.includes("Categories: Market Data, forex"));
});

test("formatInspectResult renders capability lines with coverage tags", () => {
  const output = formatInspectResult([
    {
      tool_id: "provider.tool.retrieve.v1.abc123",
      name: "Sample Tool",
      capabilities: [
        {
          id: "MKT.BARS.ADJUSTED",
          tag: [
            { id: "US", name: "United States", type: "market" },
            { id: "CN", name: "Mainland China", type: "market" },
          ],
        },
        { id: "MKT.BARS.RAW" },
      ],
    },
  ]);
  assert.ok(output.includes("Capability: MKT.BARS.ADJUSTED (US, CN)"));
  assert.ok(output.includes("Capability: MKT.BARS.RAW"));
});

test("formatInspectResult caps capability tag list at 8 entries", () => {
  const tag = Array.from({ length: 11 }, (_, i) => ({ id: `M${i}` }));
  const output = formatInspectResult([{ tool_id: "t.v1", name: "Sample Tool", capabilities: [{ id: "CAP.X", tag }] }]);
  assert.ok(output.includes("Capability: CAP.X (M0, M1, M2, M3, M4, M5, M6, M7, +3 more)"));
});

test("formatInspectResult omits capability lines when missing or malformed", () => {
  for (const capabilities of [undefined, [], "nope", [null, {}, { id: "  " }]]) {
    const output = formatInspectResult([{ tool_id: "t.v1", name: "Sample Tool", capabilities }]);
    assert.ok(!output.includes("Capability:"));
  }
});

test("formatInspectResult renders expected_cost as Est. cost row", () => {
  const output = formatInspectResult([{ tool_id: "t.v1", name: "Sample Tool", expected_cost: "24.2" }]);
  assert.ok(output.includes("Est. cost:  24.2 credits"));
});

test("formatInspectResult omits Est. cost row when expected_cost is absent or empty", () => {
  for (const expected_cost of [undefined, null, "", "   ", {}]) {
    const output = formatInspectResult([{ tool_id: "t.v1", name: "Sample Tool", expected_cost }]);
    assert.ok(!output.includes("Est. cost:"));
  }
});
