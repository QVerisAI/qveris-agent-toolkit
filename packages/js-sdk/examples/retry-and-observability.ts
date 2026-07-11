/**
 * Retry and observability: configuring rate-limit backoff and reading it back.
 *
 * A rate-limited (429) or transient (503) response is retried automatically
 * with exponential backoff and jitter, honoring the server's `Retry-After`.
 * Retried backoff is *pressure*, not failure — observe `rateLimitRetryCount`
 * rather than treating the retried responses as errors.
 *
 *   QVERIS_API_KEY=sk-... npx tsx examples/retry-and-observability.ts
 */

import { getClientOrExplain } from './_shared.js';
import { Qveris } from '@qverisai/sdk';

async function main(): Promise<void> {
  if (!getClientOrExplain()) return;

  // Configure backoff explicitly. `maxRetries` bounds how many times a 429/503
  // is retried before the error surfaces; 0 disables retries entirely. (Unlike
  // the CLI, the SDK reads this from the constructor only, not from the env.)
  const qveris = Qveris.fromEnv({ maxRetries: 5, timeoutMs: 15_000 });

  const startedAt = Date.now();
  const discovered = await qveris.discover('weather forecast API', { limit: 3 });
  const elapsedMs = Date.now() - startedAt;

  console.log(`matches: ${discovered.results.length} in ${elapsedMs}ms`);
  // Non-zero here means the client backed off and retried at least once. Track
  // this as a load signal; it is not counted against success.
  console.log(`rate_limit_retries: ${qveris.rateLimitRetryCount}`);

  // Pair QVeris usage with your own tracing (OpenTelemetry, etc.) by wrapping
  // calls in spans; the SDK stays transport-agnostic and adds no dependency.
  for (const tool of discovered.results) {
    console.log(`  ${tool.tool_id} score=${tool.final_score ?? 'n/a'} cost=${tool.expected_cost ?? 'n/a'}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
