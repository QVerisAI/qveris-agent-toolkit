import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { Qveris, type CallOptions, type ProbeOptions } from './client.js';

interface RequestContract {
  body: Record<string, unknown>;
  javascript: Record<string, string>;
}
const contracts = JSON.parse(
  readFileSync(new URL('../../../contracts/public-client-requests.v1.json', import.meta.url), 'utf8'),
) as Record<'call' | 'probe', RequestContract>;

afterEach(() => vi.unstubAllGlobals());

const summaryCases = JSON.parse(
  readFileSync(new URL('../../../contracts/result-delivery.v1.json', import.meta.url), 'utf8'),
).summary_cases as Array<{ id: string; success: boolean; result: Record<string, unknown> }>;

test.each(summaryCases)('preserves shared summary payload: $id', async ({ success, result }) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ execution_id: 'exec-summary', success, result }), { status: 200 }),
      ),
  );
  const client = new Qveris({ apiKey: '<fixture-key>', baseUrl: 'https://qveris.ai/api/v1' });
  const response = await client.call('tool-fixture', { parameters: {}, respondWith: 'summary' });
  expect(response.result).toEqual(result);
  expect(response.success).toBe(success);
});

test.each([
  { vendor: 'value', nested: { respond_with: 'provider-owned' } },
  { respond_with: 'full', data: { respond_with: 'summary', arbitrary: true } },
  [1, null, { nested: true }],
  'text',
  0,
  false,
  null,
])('full delivery preserves raw JSON without wrapping or reinterpreting it: %j', async (result) => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        execution_id: 'exec-fixture',
        success: true,
        result,
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new Qveris({ apiKey: '<fixture-key>', baseUrl: 'https://qveris.ai/api/v1' });
  const response = await client.call('tool-fixture', {
    parameters: {},
    respondWith: 'full',
  });
  expect(response.result).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(['strict', 'legacyOptionalFields'] as const)(
  'identity rejection never falls back to another identity in %s mode',
  async (compatibilityMode) => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            detail: [{ type: 'extra_forbidden', loc: ['body', 'sub_user_id'], msg: 'Unsupported identity' }],
          }),
          { status: 422 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        new Qveris({ apiKey: '<fixture-key>' }).call('tool-fixture', {
          parameters: {},
          subUserId: 'tenant-user-fixture',
          compatibilityMode,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  },
);

test.each(['call', 'probe'] as const)(
  '%s forwards every published field to HTTP without changing identity',
  async (operation) => {
    for (const identity of [undefined, 'tenant-user-fixture', '用户/tenant-A']) {
      const contract = contracts[operation];
      const body = { ...contract.body };
      if (identity === undefined) delete body.sub_user_id;
      else body.sub_user_id = identity;
      const options = Object.fromEntries(Object.entries(body).map(([key, value]) => [contract.javascript[key], value]));
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ execution_id: 'exec-fixture', success: true, result: {} }), { status: 200 }),
        );
      vi.stubGlobal('fetch', fetch);
      const client = new Qveris({ apiKey: '<fixture-key>', baseUrl: 'https://qveris.ai/api/v1' });
      // Compile-time field coverage is separately checked against these fixtures.
      if (operation === 'call') await client.call('tool/fixture', options as unknown as CallOptions);
      else await client.probe('tool/fixture', options as ProbeOptions);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).searchParams.get('tool_id')).toBe('tool/fixture');
      expect(JSON.parse(init.body as string)).toEqual(body);
    }
  },
);
