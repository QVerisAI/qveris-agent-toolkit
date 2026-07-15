import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient, normalizeBaseUrl } from '../src/api.mjs';

test('normalizes safe API base URLs and rejects unsafe values', () => {
  assert.equal(normalizeBaseUrl('https://qveris.ai/api/v1///'), 'https://qveris.ai/api/v1');
  for (const value of [
    '',
    'ftp://qveris.ai/api/v1',
    'https://user:pass@qveris.ai/api/v1',
    'https://qveris.ai/api/v1?x=1',
  ]) {
    assert.throws(() => normalizeBaseUrl(value), /QVERIS_BASE_URL/);
  }
});

test('sends bearer authentication without exposing it in API errors', async () => {
  const requests = [];
  const client = createApiClient({
    apiKey: 'secret-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response('server echoed secret-token', { status: 500 });
    },
  });

  await assert.rejects(client.discover({ query: 'weather', limit: 5 }), (error) => {
    return error.benchmarkStage === 'api' && !error.message.includes('secret-token');
  });
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-token');
});

test('rejects numeric failure envelopes', async () => {
  const client = createApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ status_code: 400, data: {}, message: 'bad' })),
  });
  await assert.rejects(client.discover({ query: 'weather', limit: 5 }), /failure envelope/);
});

test('retries rate limits and transient unavailability before scoring a failure', async () => {
  const statuses = [429, 503, 200];
  const delays = [];
  const client = createApiClient({
    apiKey: 'test-key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: statuses.shift(),
        headers: { 'retry-after': '0' },
      }),
    sleep: async (ms) => delays.push(ms),
  });

  assert.deepEqual(await client.discover({ query: 'weather', limit: 5 }), { results: [] });
  assert.deepEqual(delays, [0, 0]);
});

test('retries transient network failures before succeeding', async () => {
  let attempts = 0;
  const delays = [];
  const client = createApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => {
      attempts++;
      if (attempts < 3) throw new TypeError('transient network failure');
      return new Response(JSON.stringify({ results: [] }));
    },
    sleep: async (ms) => delays.push(ms),
  });

  assert.deepEqual(await client.discover({ query: 'weather', limit: 5 }), { results: [] });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('cancels unsuccessful response bodies before reporting API errors', async () => {
  let cancelled = false;
  const client = createApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: new Headers(),
      body: { async cancel() { cancelled = true; } },
    }),
  });

  await assert.rejects(client.discover({ query: 'weather', limit: 5 }), /HTTP 400/);
  assert.equal(cancelled, true);
});
