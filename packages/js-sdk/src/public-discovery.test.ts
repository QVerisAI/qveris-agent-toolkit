import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Qveris, QverisApiError } from './index.js';

const publicId = 'pub_11111111-1111-4111-8111-111111111111';
const publicBody = () => ({
  search_id: publicId,
  contract_features: ['public-readonly-v1'],
  results: [{ tool_id: 'tool-a' }],
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe('public discovery HTTP contract', () => {
  it('explicitly omits identity and cookies, preserves absent balance/pricing and exposes only read methods', async () => {
    const fetch = vi.fn().mockImplementation(async () => response(publicBody()));
    vi.stubGlobal('fetch', fetch);
    const client = Qveris.publicReadOnly({ baseUrl: 'https://unit.test/api/v1' });
    expect('call' in client).toBe(false);
    const found = await client.discover(' weather ', { limit: 10, view: 'routing' });
    await client.inspect(['tool-a'], { searchId: found.search_id, view: 'full' });
    expect('remaining_credits' in found).toBe(false);
    expect('expected_cost' in found.results[0]).toBe(false);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/v1/search',
      '/api/v1/tools/by-ids',
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(new Headers(options.headers).has('authorization')).toBe(false);
      expect(new Headers(options.headers).has('cookie')).toBe(false);
      expect(options.headers['X-Qveris-Access-Mode']).toBe('public-readonly');
      expect(options.credentials).toBe('omit');
      expect(options.cache).toBe('no-store');
    }
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ query: 'weather', limit: 10, view: 'routing' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      tool_ids: ['tool-a'],
      search_id: publicId,
      view: 'full',
    });
  });

  it('requires explicit opt-in and rejects even empty or failing credentials before HTTP', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(() => new Qveris({} as never)).toThrow(/API key is required/);
    for (const apiKey of ['', randomUUID()]) {
      expect(() => new Qveris({ publicReadOnly: true, apiKey } as never)).toThrow(/cannot be combined/);
    }
    const credentialProvider = { getCredential: vi.fn().mockRejectedValue(new Error('expired OAuth')) };
    expect(() => new Qveris({ publicReadOnly: true, credentialProvider } as never)).toThrow(/cannot be combined/);
    expect(credentialProvider.getCredential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks all noncatalog methods locally and validates bounded public inputs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new Qveris({ publicReadOnly: true });
    for (const operation of [
      () => client.call('a', { parameters: {} }),
      () => client.probe('a'),
      () => client.credits(),
      () => client.usage(),
      () => client.ledger(),
      () => client.capabilityDetail('a'),
    ]) {
      await expect(operation()).rejects.toThrow(/only supports Discover and Inspect/);
    }
    for (const options of [{ limit: 21 }, { limit: 0 }, { lang: 'en' as const }, { sessionId: 'private' }]) {
      await expect(client.discover('weather', options)).rejects.toThrow();
    }
    await expect(client.discover(' '.repeat(4))).rejects.toThrow();
    await expect(client.discover('x'.repeat(1025))).rejects.toThrow();
    for (const ids of [[], ['a', 'a'], ['x'.repeat(256)], Array.from({ length: 11 }, (_, index) => String(index))]) {
      await expect(client.inspect(ids)).rejects.toThrow();
    }
    await expect(client.inspect(['a'], { searchId: 'private-context' })).rejects.toThrow();
    await expect(client.inspect(Array.from({ length: 10 }, (_, i) => `${i}${'😀'.repeat(250)}`))).rejects.toThrow(
      /8192/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects incompatible or private responses and never retries authentication as public', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new Qveris({ publicReadOnly: true });
    for (const body of [
      { search_id: 'private', results: [] },
      { ...publicBody(), remaining_credits: 0 },
    ]) {
      fetch.mockResolvedValueOnce(response(body));
      await expect(client.discover('weather')).rejects.toMatchObject({
        observability: { error_type: 'invalid_response' },
      });
    }
    fetch.mockResolvedValueOnce(response({ message: 'Authentication required' }, 401));
    await expect(client.discover('weather')).rejects.toMatchObject({ status: 401 });
    const authenticated = new Qveris({ apiKey: randomUUID() });
    fetch.mockResolvedValueOnce(response({ message: 'Invalid credential' }, 401));
    await expect(authenticated.discover('weather')).rejects.toBeInstanceOf(QverisApiError);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][1].headers['X-Qveris-Access-Mode']).toBeUndefined();
  });

  it('requires new authenticated inspection and a fresh quote before explicitly calling the selected public tool', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(publicBody()));
    vi.stubGlobal('fetch', fetch);
    const publicClient = Qveris.publicReadOnly();
    const selection = (await publicClient.discover('weather')).results[0];
    const authenticated = new Qveris({ apiKey: randomUUID() });
    const parameters = { city: 'London' };
    await expect(authenticated.call(selection.tool_id, { searchId: publicId, parameters })).rejects.toThrow(
      /Public context/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response({ search_id: 'auth-search', results: [{ tool_id: selection.tool_id }] }));
    const current = await authenticated.inspect(selection.tool_id);
    fetch.mockResolvedValueOnce(
      response({
        executable: true,
        schema: { valid: true },
        quote: { currency: 'credits', exact: true, estimate_credits: 1 },
      }),
    );
    await authenticated.probe(selection.tool_id, { parameters, checks: ['schema', 'quote'] });
    fetch.mockResolvedValueOnce(response({ success: true, execution_id: 'synthetic-execution', result: {} }));
    await authenticated.call(current.results[0].tool_id, { searchId: current.search_id, parameters });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetch.mock.calls[3][1].body).search_id).toBe('auth-search');
    expect(parameters).toEqual({ city: 'London' });
  });
});

it('typechecks explicit construction and the restricted public result/method surface', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qveris-public-types-'));
  const file = join(directory, 'consumer.mts');
  const source = fileURLToPath(new URL('./index.js', import.meta.url)).replaceAll('\\', '/');
  writeFileSync(
    file,
    `import { Qveris } from ${JSON.stringify(source)};
const client = Qveris.publicReadOnly();
declare const credential: string;
new Qveris({publicReadOnly: true});
new Qveris({apiKey: credential});
// @ts-expect-error Default constructor still needs credentials.
new Qveris({});
// @ts-expect-error Mixed identities are forbidden.
new Qveris({publicReadOnly: true, apiKey: credential});
// @ts-expect-error Public clients do not expose Call.
client.call('a', {parameters: {}});
// @ts-expect-error Public requests cannot carry private sessions.
client.discover('weather', {sessionId: 'private'});
const result = await client.discover('weather');
// @ts-expect-error Public results have no account balance.
result.remaining_credits;
// @ts-expect-error Public results have no price contract.
result.results[0].expected_cost;
// @ts-expect-error Private correlation cannot be used in public Inspect.
client.inspect('a', {searchId: 'private'});
`,
  );
  try {
    const output = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
        '--strict',
        '--skipLibCheck',
        '--noEmit',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--typeRoots',
        fileURLToPath(new URL('../node_modules/@types', import.meta.url)),
        file,
      ],
      { encoding: 'utf8' },
    );
    expect(output.stdout + output.stderr).toBe('');
    expect(output.status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
