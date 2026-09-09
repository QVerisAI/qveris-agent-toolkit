/**
 * Quickstart: the default discover -> call -> audit path.
 *
 * Discovery is free. The `call` step is gated behind
 * `RUN_QVERIS_CALLS=1` because it may consume credits.
 * For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote.
 * Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.
 *
 *   QVERIS_API_KEY=sk-... npx tsx examples/quickstart.ts
 *   QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 npx tsx examples/quickstart.ts
 */

import { getClientOrExplain, shouldCall, supportsParameters } from './_shared.js';

async function main(): Promise<void> {
  const qveris = getClientOrExplain();
  if (!qveris) return;

  // 1. Discover — natural-language query, free, returns candidates + a search_id.
  const discovered = await qveris.discover('public company stock quote and market data API', { limit: 5 });
  console.log(`search_id: ${discovered.search_id}`);
  console.log(`matches: ${discovered.results.length} / total=${discovered.total}`);
  if (discovered.results.length === 0) return;

  // 2. Select a capability from its actual contract, not its rank or name alone.
  //    An explicit [] means zero parameters; undefined means the compact result
  //    omitted the contract, so inspect promising candidates before calling.
  const parameters: Record<string, unknown> = { symbol: 'AAPL' };
  let tool = discovered.results.find((candidate) => supportsParameters(candidate, parameters));
  if (!tool) {
    const details = await qveris.inspect(
      discovered.results.slice(0, 3).map((candidate) => candidate.tool_id),
      { searchId: discovered.search_id },
    );
    tool = details.results.find((candidate) => supportsParameters(candidate, parameters));
  }
  if (!tool || !Array.isArray(tool.params)) {
    throw new Error('No candidate exposed a current parameter contract with a symbol field.');
  }
  console.log(`selected: ${tool.tool_id} - ${tool.name || tool.description || 'unnamed'}`);
  if (tool.stats) {
    console.log(`quality: success_rate=${tool.stats.success_rate} latency_ms=${tool.stats.avg_execution_time_ms}`);
  }
  if (tool.expected_cost !== undefined) {
    console.log(`expected_cost: ${tool.expected_cost}`);
  }

  // Sample values describe shape only; build values from this request.
  const missing = tool.params.filter((param) => param.required && parameters[param.name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required business inputs: ${missing.map((param) => param.name).join(', ')}`);
  }
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
