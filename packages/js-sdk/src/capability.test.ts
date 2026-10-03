import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Qveris } from './client.js';
import { QverisApiError } from './errors.js';

const fixtures = JSON.parse(
  readFileSync(new URL('../../../docs/openapi/qveris-public-api.projection-fixtures.json', import.meta.url), 'utf8'),
);
afterEach(() => vi.unstubAllGlobals());

it('uses the published detail/query fixtures and preserves wire request fields', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(fixtures.capability_detail.response)))
    .mockResolvedValueOnce(new Response(JSON.stringify(fixtures.capability_query.response)));
  vi.stubGlobal('fetch', fetchImpl);
  const contexts: Array<{ operation?: string; purpose?: string }> = [];
  const client = new Qveris({
    credentialProvider: {
      getCredential: async (context) => {
        contexts.push(context);
        return 'fixture-credential';
      },
    },
  });
  expect(await client.capabilityDetail('MKT/BARS', { runId: 'run-1', providerId: 'provider-1' })).toEqual(
    fixtures.capability_detail.response,
  );
  expect(fetchImpl.mock.calls[0][0]).toContain('/capabilities/MKT%2FBARS?run_id=run-1&provider_id=provider-1');
  expect(await client.capabilityQuery(fixtures.capability_query.request)).toEqual(fixtures.capability_query.response);
  const init = fetchImpl.mock.calls[1][1];
  expect(JSON.parse(init.body)).toEqual(fixtures.capability_query.request);
  expect(init.redirect).toBe('error');
  expect(contexts[1]).toMatchObject({ operation: 'capability_query', purpose: 'paid_execution' });
});

it.each([401, 429, 503, 307, 308])('never resubmits CAP Query after HTTP %s', async (status) => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ message: 'fixture failure' }), { status, headers: { 'Retry-After': '0' } }),
    );
  vi.stubGlobal('fetch', fetchImpl);
  const client = new Qveris({ apiKey: '<fixture-key>', maxRetries: 3 });
  await expect(client.capabilityQuery({ capability_id: 'MKT.BARS.EOD' })).rejects.toBeInstanceOf(QverisApiError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each(['network', 'timeout', 'invalid_json', 'invalid_contract'])(
  'requires review for unknown Query outcome: %s',
  async (kind) => {
    const fetchImpl = vi.fn(async () => {
      if (kind === 'network') throw new Error('synthetic transport failure');
      if (kind === 'timeout') throw new DOMException('synthetic timeout', 'AbortError');
      return new Response(kind === 'invalid_json' ? '{' : JSON.stringify({ success: 'true' }));
    });
    vi.stubGlobal('fetch', fetchImpl);
    const client = new Qveris({ apiKey: '<fixture-key>' });
    await expect(client.capabilityQuery({ query: 'weather' })).rejects.toMatchObject({
      next_action: { action: 'review_settlement', automatic: false },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);

it('rejects empty selectors and invalid budgets before requesting credentials', async () => {
  const fetchImpl = vi.fn();
  vi.stubGlobal('fetch', fetchImpl);
  const client = new Qveris({ apiKey: '<fixture-key>' });
  await expect(client.capabilityQuery({ query: ' ' })).rejects.toThrow(/required/);
  await expect(client.capabilityQuery({ capability_id: 'MKT.BARS.EOD', query: ' ' })).rejects.toThrow(/non-empty/);
  await expect(client.capabilityQuery({ capability_id: '', query: 'weather' })).rejects.toThrow(/non-empty/);
  await expect(client.capabilityQuery({ query: 'weather', max_credits: Infinity })).rejects.toThrow(/positive/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('preserves execution identity when a Query response needs reconciliation', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ execution_id: 'execution-1', success: 'true' })));
  vi.stubGlobal('fetch', fetchImpl);
  const client = new Qveris({ apiKey: '<fixture-key>' });
  await expect(client.capabilityQuery({ query: 'weather' })).rejects.toMatchObject({
    details: { execution_id: 'execution-1' },
    observability: { error_type: 'invalid_response' },
    next_action: { action: 'reconcile_settlement', automatic: false },
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
