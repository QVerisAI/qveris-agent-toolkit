/**
 * Quickstart: the full discover -> inspect -> call -> audit loop.
 *
 * Discovery and inspection are free. The `call` step is gated behind
 * `RUN_QVERIS_CALLS=1` because it may consume credits.
 *
 *   QVERIS_API_KEY=sk-... npx tsx examples/quickstart.ts
 *   QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 npx tsx examples/quickstart.ts
 */

import { getClientOrExplain, sampleParameters, shouldCall } from './_shared.js';

async function main(): Promise<void> {
  const qveris = getClientOrExplain();
  if (!qveris) return;

  // 1. Discover — natural-language query, free, returns candidates + a search_id.
  const discovered = await qveris.discover('public company stock quote and market data API', { limit: 5 });
  console.log(`search_id: ${discovered.search_id}`);
  console.log(`matches: ${discovered.results.length} / total=${discovered.total}`);
  if (discovered.results.length === 0) return;

  // 2. Inspect — read the current parameter schema and routing signals, free.
  //    Pass the search_id so the inspection is attributed to this discovery.
  const first = discovered.results[0];
  const inspected = await qveris.inspect([first.tool_id], { searchId: discovered.search_id });
  const tool = inspected.results[0] ?? first;
  console.log(`selected: ${tool.tool_id} - ${tool.name || tool.description || 'unnamed'}`);
  if (tool.stats) {
    console.log(`quality: success_rate=${tool.stats.success_rate} latency_ms=${tool.stats.avg_execution_time_ms}`);
  }
  if (tool.expected_cost !== undefined) {
    console.log(`expected_cost: ${tool.expected_cost}`);
  }

  const parameters = sampleParameters(tool, { symbol: 'AAPL' });
  console.log(`params: ${JSON.stringify(parameters)}`);

  if (!shouldCall()) {
    console.log('Set RUN_QVERIS_CALLS=1 to execute the selected capability.');
    return;
  }

  // 3. Call — execute the capability. May consume credits.
  const result = await qveris.call(tool.tool_id, { parameters, searchId: discovered.search_id });
  console.log(`execution_id: ${result.execution_id}`);
  console.log(`success: ${result.success}`);
  console.log(`billing: ${result.billing?.summary ?? 'n/a'}`);

  // 4. Audit — the call response carries a pre-settlement estimate; usage and
  //    the credits ledger reflect the final, settled charge.
  const usage = await qveris.usage({ execution_id: result.execution_id, summary: true, limit: 5 });
  console.log(`usage_records: ${usage.total}`);
  const ledger = await qveris.ledger({ summary: true, limit: 5 });
  console.log(`ledger_records: ${ledger.total}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
