#!/usr/bin/env node

import { discoverTools } from '../../../packages/cli/src/client/api.mjs';

const apiKey = process.env.QVERIS_API_KEY;
if (!apiKey) throw new Error('QVERIS_API_KEY is required for the optional live smoke lane');
const baseUrl = process.env.QVERIS_BASE_URL;
const started = new Date().toISOString();
try {
  const result = await discoverTools({ apiKey, baseUrl, query: 'public weather data', limit: 3 });
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: 1,
        lane: 'live_smoke',
        started_at: started,
        production_success_claim: false,
        status: 'observed',
        search_id_present: typeof result?.search_id === 'string',
        result_count: Array.isArray(result?.results) ? result.results.length : null,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: 1,
        lane: 'live_smoke',
        started_at: started,
        production_success_claim: false,
        status: 'environment_or_service_failure',
        error_code: error?.code ?? 'UNKNOWN',
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
}
