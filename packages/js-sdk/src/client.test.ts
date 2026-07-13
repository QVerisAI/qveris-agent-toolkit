import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Qveris } from './client.js';
import { QverisApiError } from './errors.js';
import type { ToolCategory, ToolCapability } from './types.js';

const API_KEY = 'sk-test-key';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(jsonResponse(body, status));
}

const SAMPLE_DISCOVER_RESPONSE = {
  search_id: 'search-123',
  total: 1,
  results: [
    {
      tool_id: 'weather.forecast.v1',
      name: 'Weather Forecast',
      description: 'Forecast by location',
      provider_name: 'Weather',
      categories: [{ slug: 'weather', name: 'Weather', description: 'Weather related tools.' }, 'legacy-string-tag'],
      capabilities: [
        {
          id: 'WX.FORECAST.DAILY',
          tag: [{ id: 'US', name: 'United States', type: 'market' }],
        },
      ],
      params: [{ name: 'city', type: 'string', required: true, description: 'City name' }],
      stats: { avg_execution_time_ms: 42.5, success_rate: 0.99 },
      billing_rule: {
        metering_mode: 'per_request',
        price: { amount_credits: 3, unit: 'request' },
      },
      expected_cost: '3.0',
      why_recommended: 'Matched both semantic and keyword relevance signals.',
    },
  ],
  elapsed_time_ms: 12.5,
};

describe('Qveris client', () => {
  let originalFetch: typeof globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env = { ...originalEnv };
    delete process.env.QVERIS_BASE_URL;
    delete process.env.QVERIS_REGION;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('requires an API key', () => {
    expect(() => new Qveris({ apiKey: '' })).toThrow(/API key is required/);
  });

  it('does not infer the endpoint from the API key or QVERIS_REGION', async () => {
    const fetchMock = mockFetch(SAMPLE_DISCOVER_RESPONSE);
    globalThis.fetch = fetchMock;
    process.env.QVERIS_REGION = 'cn';

    await new Qveris({ apiKey: 'sk-cn-test' }).discover('weather');
    expect(fetchMock.mock.calls[0][0]).toBe('https://qveris.ai/api/v1/search');
  });

  it('uses QVERIS_BASE_URL and strips trailing slashes', async () => {
    const fetchMock = mockFetch(SAMPLE_DISCOVER_RESPONSE);
    globalThis.fetch = fetchMock;
    process.env.QVERIS_BASE_URL = 'https://env.example/api/v1///';

    const client = new Qveris({ apiKey: API_KEY });
    await client.discover('weather');
    expect(fetchMock.mock.calls[0][0]).toBe('https://env.example/api/v1/search');
  });

  it('rejects an explicitly empty QVERIS_BASE_URL', () => {
    process.env.QVERIS_BASE_URL = '';
    expect(() => new Qveris({ apiKey: API_KEY })).toThrow(/base URL must not be empty/);
  });

  it('explicit baseUrl overrides QVERIS_BASE_URL', async () => {
    const fetchMock = mockFetch(SAMPLE_DISCOVER_RESPONSE);
    globalThis.fetch = fetchMock;
    process.env.QVERIS_BASE_URL = 'https://env.example/api/v1';

    const client = new Qveris({ apiKey: API_KEY, baseUrl: 'https://explicit.example/api/v1/' });
    await client.discover('weather');
    expect(fetchMock.mock.calls[0][0]).toBe('https://explicit.example/api/v1/search');
  });

  it.each([
    '',
    'ftp://example.test/api/v1',
    'https://exa mple.test/api/v1',
    'https://example.test\\@other.test/api/v1',
    'https://user:pass@example.test/api/v1',
    'https://example.test/api/v1?mode=test',
    'https://example.test/api/v1#section',
  ])('rejects unsafe base URL %j', (baseUrl) => {
    expect(() => new Qveris({ apiKey: API_KEY, baseUrl })).toThrow(/base URL/);
  });

  it('discover posts query/limit/session_id and parses the modern result shape', async () => {
    const fetchMock = mockFetch(SAMPLE_DISCOVER_RESPONSE);
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.discover('weather forecast API', {
      limit: 3,
      sessionId: 'session-1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qveris.ai/api/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body)).toEqual({
      query: 'weather forecast API',
      limit: 3,
      session_id: 'session-1',
    });

    expect(response.search_id).toBe('search-123');
    const tool = response.results[0];
    const categories = tool.categories as Array<string | ToolCategory>;
    expect((categories[0] as ToolCategory).slug).toBe('weather');
    expect(categories[1]).toBe('legacy-string-tag');
    const capabilities = tool.capabilities as ToolCapability[];
    expect(capabilities[0].id).toBe('WX.FORECAST.DAILY');
    expect(capabilities[0].tag?.[0].id).toBe('US');
    expect(tool.expected_cost).toBe('3.0');
    expect(tool.why_recommended).toContain('semantic and keyword');
  });

  it('inspect posts tool_ids and search_id, coercing a single string id', async () => {
    const fetchMock = mockFetch({
      search_id: 'search-123',
      results: [{ tool_id: 'weather.forecast.v1', description: 'Forecast' }],
    });
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.inspect('weather.forecast.v1', { searchId: 'search-123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qveris.ai/api/v1/tools/by-ids');
    expect(JSON.parse(init.body)).toEqual({
      tool_ids: ['weather.forecast.v1'],
      search_id: 'search-123',
    });
    expect(response.results[0].tool_id).toBe('weather.forecast.v1');
  });

  it('inspect with an empty id list returns an empty response without a request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.inspect([], { searchId: 'search-123' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.search_id).toBe('search-123');
    expect(response.total).toBe(0);
    expect(response.results).toEqual([]);
  });

  it('call sends tool_id as query param and parameters/search_id/max_response_size in the body', async () => {
    const fetchMock = mockFetch({
      execution_id: 'exec-123',
      tool_id: 'weather.forecast.v1',
      parameters: { city: 'London' },
      success: true,
      result: { data: { temperature: 18 } },
      billing: {
        summary: '3 credits per successful request',
        list_amount_credits: 3,
        charge_lines: [{ component_key: 'request', amount_credits: 3, unit: 'request' }],
      },
      remaining_credits: 997,
    });
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.call('weather.forecast.v1', {
      parameters: { city: 'London' },
      searchId: 'search-123',
      maxResponseSize: 20480,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qveris.ai/api/v1/tools/execute?tool_id=weather.forecast.v1');
    expect(JSON.parse(init.body)).toEqual({
      parameters: { city: 'London' },
      search_id: 'search-123',
      max_response_size: 20480,
    });
    expect(response.execution_id).toBe('exec-123');
    expect(response.billing?.list_amount_credits).toBe(3);
    expect(response.billing?.charge_lines?.[0].component_key).toBe('request');
  });

  it('unwraps {status: "success", data: ...} envelopes', async () => {
    globalThis.fetch = mockFetch({
      status: 'success',
      data: { search_id: 'search-123', results: [], total: 0 },
    });

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.discover('weather forecast API');
    expect(response.search_id).toBe('search-123');
    expect(response.results).toEqual([]);
  });

  it('throws QverisApiError on a failure envelope before result parsing', async () => {
    globalThis.fetch = mockFetch({
      status: 'failure',
      message: 'quota exhausted',
      data: { unexpected: 'shape' },
    });

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.discover('weather').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QverisApiError);
    expect((error as QverisApiError).message).toContain('quota exhausted');
  });

  it('throws QverisApiError with parsed message and details on HTTP errors', async () => {
    globalThis.fetch = mockFetch({ error_message: 'bad key' }, 401);

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.discover('weather').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QverisApiError);
    const apiError = error as QverisApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.message).toBe('bad key');
    expect(apiError.observability?.operation).toBe('discover');
    expect(apiError.observability?.error_type).toBe('http_error');
  });

  it('adds a purchase hint on 402 responses', async () => {
    globalThis.fetch = mockFetch({ message: 'balance too low' }, 402);

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.call('t.v1', { parameters: {} }).catch((e: unknown) => e);
    expect((error as QverisApiError).message).toContain('Insufficient credits');
    expect((error as QverisApiError).message).toContain('https://qveris.ai/pricing');
  });

  it('usage() issues a GET with query filters and unwraps the envelope', async () => {
    const fetchMock = mockFetch({
      status: 'success',
      data: {
        items: [
          {
            id: 'usage-1',
            event_type: 'tool_execute',
            source_system: 'qveris',
            success: true,
            charge_outcome: 'charged',
            execution_id: 'exec-123',
            actual_amount_credits: 3,
            created_at: '2026-05-10T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 1,
        summary: { total_credits: 3 },
      },
    });
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.usage({ execution_id: 'exec-123', summary: true });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/auth/usage/history/v2');
    expect(url.searchParams.get('execution_id')).toBe('exec-123');
    expect(url.searchParams.get('summary')).toBe('true');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');

    expect(response.total).toBe(1);
    expect(response.items[0].charge_outcome).toBe('charged');
    expect(response.summary).toEqual({ total_credits: 3 });
  });

  it('ledger() issues a GET with query filters and unwraps the envelope', async () => {
    const fetchMock = mockFetch({
      status: 'success',
      data: {
        items: [
          {
            id: 'ledger-1',
            entry_type: 'consume_tool_execute',
            amount_credits: -3,
            source_system: 'qveris',
            source_ref_type: 'execution',
            source_ref_id: 'exec-123',
            created_at: '2026-05-10T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 1,
        summary: { net_credits: -3 },
      },
    });
    globalThis.fetch = fetchMock;

    const client = new Qveris({ apiKey: API_KEY });
    const response = await client.ledger({ direction: 'consume', min_credits: 1.5 });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/auth/credits/ledger');
    expect(url.searchParams.get('direction')).toBe('consume');
    expect(url.searchParams.get('min_credits')).toBe('1.5');

    expect(response.items[0].entry_type).toBe('consume_tool_execute');
    expect(response.summary).toEqual({ net_credits: -3 });
  });

  it('maps aborted requests to status 408 with timeout error_type', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.discover('weather').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QverisApiError);
    expect((error as QverisApiError).status).toBe(408);
    expect((error as QverisApiError).message).toContain('timed out');
    expect((error as QverisApiError).observability?.error_type).toBe('timeout');
  });

  it('wraps network failures in QverisApiError with status 0', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('socket hang up'));

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.discover('weather').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QverisApiError);
    expect((error as QverisApiError).status).toBe(0);
    expect((error as QverisApiError).message).toBe('socket hang up');
    expect((error as QverisApiError).observability?.error_type).toBe('network_error');
  });

  it('throws QverisApiError on invalid JSON bodies', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      headers: new Headers(),
    } as unknown as Response);

    const client = new Qveris({ apiKey: API_KEY });
    const error = await client.discover('weather').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QverisApiError);
    expect((error as QverisApiError).observability?.error_type).toBe('invalid_json');
  });

  describe('rate-limit retries', () => {
    function rateLimited(retryAfter?: string): Response {
      const headers = new Headers();
      if (retryAfter) headers.set('Retry-After', retryAfter);
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ error: 'rate limited' }),
        headers,
      } as unknown as Response;
    }

    it('retries a 429 then succeeds, counting the backoff', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rateLimited('1'))
        .mockResolvedValueOnce(jsonResponse(SAMPLE_DISCOVER_RESPONSE));
      globalThis.fetch = fetchMock;

      const client = new Qveris({ apiKey: API_KEY });
      vi.spyOn(client as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);

      const result = await client.discover('weather');

      expect(result.search_id).toBe('search-123');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(client.rateLimitRetryCount).toBe(1);
    });

    it('gives up after maxRetries and throws the final 429', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rateLimited());
      globalThis.fetch = fetchMock;

      const client = new Qveris({ apiKey: API_KEY, maxRetries: 2 });
      vi.spyOn(client as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);

      const error = await client.discover('weather').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(QverisApiError);
      expect((error as QverisApiError).status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(3); // maxRetries + 1
      expect(client.rateLimitRetryCount).toBe(2);
    });

    it('maxRetries=0 disables retrying', async () => {
      const fetchMock = vi.fn().mockResolvedValue(rateLimited());
      globalThis.fetch = fetchMock;

      const client = new Qveris({ apiKey: API_KEY, maxRetries: 0 });

      const error = await client.discover('weather').catch((e: unknown) => e);

      expect((error as QverisApiError).status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(client.rateLimitRetryCount).toBe(0);
    });
  });
});
