/**
 * Unit tests for the Qveris API Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QverisClient, createClientFromEnv } from './client.js';

describe('QverisClient', () => {
  describe('constructor', () => {
    it('should create client with valid API key', () => {
      const client = new QverisClient({ apiKey: 'test-api-key' });
      expect(client).toBeInstanceOf(QverisClient);
    });

    it('should throw error when API key is missing', () => {
      expect(() => new QverisClient({ apiKey: '' })).toThrow('Qveris API key is required');
    });

    it('should accept custom base URL', () => {
      const client = new QverisClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      expect(client).toBeInstanceOf(QverisClient);
    });

    it.each([
      '',
      'ftp://example.test/api/v1',
      'https://exa mple.test/api/v1',
      'https://example.test\\@other.test/api/v1',
      'https://user:pass@example.test/api/v1',
      'https://example.test/api/v1?mode=test',
      'https://example.test/api/v1?',
      'https://example.test/api/v1#section',
      'https://example.test/api/v1#',
    ])('should reject unsafe base URL %j', (baseUrl) => {
      expect(() => new QverisClient({ apiKey: 'test-key', baseUrl })).toThrow(/base URL/);
    });
  });

  describe('endpoint resolution', () => {
    const originalEnv = process.env;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.QVERIS_BASE_URL;
      delete process.env.QVERIS_REGION;
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ search_id: 'search-123', results: [], total: 0 }),
      });
      global.fetch = fetchMock;
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.restoreAllMocks();
    });

    it('does not infer the endpoint from the API key or QVERIS_REGION', async () => {
      process.env.QVERIS_REGION = 'cn';
      await new QverisClient({ apiKey: 'sk-cn-test' }).searchTools({ query: 'weather' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://qveris.ai/api/v1/search');
    });

    it('uses QVERIS_BASE_URL when no explicit base URL is provided', async () => {
      process.env.QVERIS_BASE_URL = 'https://env.example/api/v1///';
      await new QverisClient({ apiKey: 'test-key' }).searchTools({ query: 'weather' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://env.example/api/v1/search');
    });

    it('rejects an explicitly empty QVERIS_BASE_URL', () => {
      process.env.QVERIS_BASE_URL = '';
      expect(() => new QverisClient({ apiKey: 'test-key' })).toThrow(/base URL must not be empty/);
    });

    it('prefers an explicit base URL over QVERIS_BASE_URL', async () => {
      process.env.QVERIS_BASE_URL = 'https://env.example/api/v1';
      await new QverisClient({
        apiKey: 'test-key',
        baseUrl: 'https://explicit.example/api/v1/',
      }).searchTools({ query: 'weather' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://explicit.example/api/v1/search');
    });
  });

  describe('searchTools', () => {
    let client: QverisClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new QverisClient({ apiKey: 'test-api-key' });
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make POST request to /search endpoint', async () => {
      const mockResponse = {
        search_id: 'search-123',
        results: [],
        total: 0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.searchTools({
        query: 'weather API',
        limit: 10,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: 'weather API',
            limit: 10,
          }),
        }),
      );

      expect(result).toEqual(mockResponse);
    });

    it('should include session_id when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ search_id: 'search-123', results: [] }),
      });

      await client.searchTools({
        query: 'email',
        session_id: 'session-abc',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: 'email',
            session_id: 'session-abc',
          }),
        }),
      );
    });

    it('should throw ApiError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      await expect(client.searchTools({ query: 'test' })).rejects.toMatchObject({
        status: 401,
        message: 'Invalid API key',
        details: { message: 'Invalid API key' },
      });
    });

    it('should handle non-JSON error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      await expect(client.searchTools({ query: 'test' })).rejects.toMatchObject({
        status: 500,
        message: 'Internal Server Error',
      });
    });

    it('should convert fetch network failures to observable ApiError', async () => {
      fetchMock.mockRejectedValueOnce(new Error('fetch failed', { cause: new Error('ECONNRESET') }));

      await expect(client.searchTools({ query: 'test' })).rejects.toMatchObject({
        status: 0,
        message: 'fetch failed',
        cause: 'ECONNRESET',
        observability: {
          operation: 'discover',
          endpoint: '/search',
          http_status: 0,
          error_type: 'network_error',
        },
      });
    });

    it('should mark timeouts as transport failures in observability', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      await expect(client.searchTools({ query: 'test' })).rejects.toMatchObject({
        status: 408,
        message: 'Request timed out. Check connectivity or increase timeout.',
        observability: {
          operation: 'discover',
          endpoint: '/search',
          http_status: 0,
          error_type: 'timeout',
        },
      });
    });
  });

  describe('getToolsByIds', () => {
    let client: QverisClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new QverisClient({ apiKey: 'test-api-key' });
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make POST request to /tools/by-ids endpoint', async () => {
      const mockResponse = {
        search_id: 'search-123',
        results: [
          {
            tool_id: 'weather-tool-1',
            name: 'Weather API',
            description: 'Get weather data',
          },
        ],
        total: 1,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getToolsByIds({
        tool_ids: ['weather-tool-1'],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/tools/by-ids',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tool_ids: ['weather-tool-1'],
          }),
        }),
      );

      expect(result).toEqual(mockResponse);
    });

    it('should include search_id and session_id when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          search_id: 'search-456',
          results: [],
        }),
      });

      await client.getToolsByIds({
        tool_ids: ['tool-1', 'tool-2'],
        search_id: 'search-456',
        session_id: 'session-abc',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            tool_ids: ['tool-1', 'tool-2'],
            search_id: 'search-456',
            session_id: 'session-abc',
          }),
        }),
      );
    });

    it('should handle multiple tool IDs', async () => {
      const toolIds = ['tool-1', 'tool-2', 'tool-3'];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          search_id: 'search-123',
          results: toolIds.map((id) => ({
            tool_id: id,
            name: `Tool ${id}`,
            description: `Description for ${id}`,
          })),
          total: toolIds.length,
        }),
      });

      const result = await client.getToolsByIds({
        tool_ids: toolIds,
      });

      expect(result.results).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should throw ApiError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid tool_ids' }),
      });

      await expect(client.getToolsByIds({ tool_ids: [] })).rejects.toMatchObject({
        status: 400,
        message: 'Invalid tool_ids',
        details: { message: 'Invalid tool_ids' },
      });
    });

    it('should handle non-JSON error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      await expect(client.getToolsByIds({ tool_ids: ['tool-1'] })).rejects.toMatchObject({
        status: 500,
        message: 'Internal Server Error',
      });
    });
  });

  describe('executeTool', () => {
    let client: QverisClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new QverisClient({ apiKey: 'test-api-key' });
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make POST request to /tools/execute endpoint with tool_id', async () => {
      const mockResponse = {
        execution_id: 'exec-123',
        tool_id: 'weather-tool',
        success: true,
        result: { data: { temperature: 20 } },
        created_at: '2025-01-15T10:00:00Z',
        parameters: { city: 'London' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.executeTool('weather-tool', {
        search_id: 'search-123',
        parameters: { city: 'London' },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/tools/execute?tool_id=weather-tool',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            search_id: 'search-123',
            parameters: { city: 'London' },
          }),
        }),
      );

      expect(result).toEqual(mockResponse);
    });

    it('should URL-encode tool_id', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          execution_id: 'exec-123',
          tool_id: 'tool/with/slashes',
          success: true,
          created_at: '2025-01-15T10:00:00Z',
          parameters: {},
        }),
      });

      await client.executeTool('tool/with/slashes', {
        search_id: 'search-123',
        parameters: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/tools/execute?tool_id=tool%2Fwith%2Fslashes',
        expect.any(Object),
      );
    });

    it('should include max_response_size when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          execution_id: 'exec-123',
          tool_id: 'tool-1',
          success: true,
          created_at: '2025-01-15T10:00:00Z',
          parameters: {},
        }),
      });

      await client.executeTool('tool-1', {
        search_id: 'search-123',
        parameters: {},
        max_response_size: 102400,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            search_id: 'search-123',
            parameters: {},
            max_response_size: 102400,
          }),
        }),
      );
    });
  });

  describe('audit endpoints', () => {
    let client: QverisClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new QverisClient({ apiKey: 'test-api-key' });
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make GET request to usage history with query filters', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getUsageHistory({
        start_date: '2026-05-01',
        end_date: '2026-05-04',
        execution_id: 'exec-123',
        min_credits: 30,
        max_credits: 100,
        summary: true,
        bucket: 'hour',
        limit: 10,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/auth/usage/history/v2?start_date=2026-05-01&end_date=2026-05-04&execution_id=exec-123&min_credits=30&max_credits=100&summary=true&bucket=hour&limit=10',
        expect.objectContaining({
          method: 'GET',
          body: undefined,
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should make GET request to credits ledger with amount filters', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.getCreditsLedger({
        direction: 'consume',
        min_credits: 50,
        summary: true,
        limit: 10,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://qveris.ai/api/v1/auth/credits/ledger?direction=consume&min_credits=50&summary=true&limit=10',
        expect.objectContaining({
          method: 'GET',
          body: undefined,
        }),
      );
    });
  });
});

describe('createClientFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client from QVERIS_API_KEY env var', () => {
    process.env.QVERIS_API_KEY = 'env-api-key';
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(QverisClient);
  });

  it('should throw error when QVERIS_API_KEY is not set', () => {
    delete process.env.QVERIS_API_KEY;
    expect(() => createClientFromEnv()).toThrow('QVERIS_API_KEY environment variable is required');
  });
});

describe('QverisClient rate-limit retries', () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.QVERIS_MAX_RETRIES;
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Retry-After: 0 -> the retry sleep is 0ms, so the test doesn't actually wait.
  function rateLimited() {
    return {
      ok: false,
      status: 429,
      body: null,
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '0' : null) },
      json: async () => ({ error_message: 'rate limited' }),
    };
  }

  function ok(payload: unknown) {
    return { ok: true, json: async () => payload };
  }

  it('retries a 429 then succeeds, counting the backoff', async () => {
    fetchMock
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok({ search_id: 's1', results: [], total: 0 }));

    const client = new QverisClient({ apiKey: 'test-api-key' });
    const result = await client.searchTools({ query: 'weather' });

    expect(result.search_id).toBe('s1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.rateLimitRetryCount).toBe(1);
  });

  it('gives up after QVERIS_MAX_RETRIES and throws the final 429', async () => {
    process.env.QVERIS_MAX_RETRIES = '2';
    fetchMock.mockResolvedValue(rateLimited());

    const client = new QverisClient({ apiKey: 'test-api-key' });
    const err = await client.searchTools({ query: 'weather' }).catch((e: unknown) => e);

    expect((err as { status: number }).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3); // maxRetries + 1
    expect(client.rateLimitRetryCount).toBe(2);
  });

  it('QVERIS_MAX_RETRIES=0 disables retrying', async () => {
    process.env.QVERIS_MAX_RETRIES = '0';
    fetchMock.mockResolvedValue(rateLimited());

    const client = new QverisClient({ apiKey: 'test-api-key' });
    const err = await client.searchTools({ query: 'weather' }).catch((e: unknown) => e);

    expect((err as { status: number }).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.rateLimitRetryCount).toBe(0);
  });

  it('config.maxRetries takes precedence over QVERIS_MAX_RETRIES', async () => {
    process.env.QVERIS_MAX_RETRIES = '5';
    fetchMock.mockResolvedValue(rateLimited());

    const client = new QverisClient({ apiKey: 'test-api-key', maxRetries: 1 });
    const err = await client.searchTools({ query: 'weather' }).catch((e: unknown) => e);

    expect((err as { status: number }).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2); // config's 1 retry, not env's 5
    expect(client.rateLimitRetryCount).toBe(1);
  });
});
