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
      expect(() => new QverisClient({ apiKey: '' })).toThrow(
        'Qveris API key is required'
      );
    });

    it('should accept custom base URL', () => {
      const client = new QverisClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      expect(client).toBeInstanceOf(QverisClient);
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
        })
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
        })
      );
    });

    it('should throw ApiError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      await expect(client.searchTools({ query: 'test' })).rejects.toEqual({
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

      await expect(client.searchTools({ query: 'test' })).rejects.toEqual({
        status: 500,
        message: 'Internal Server Error',
        details: undefined,
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
        })
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
        })
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

      await expect(
        client.getToolsByIds({ tool_ids: [] })
      ).rejects.toEqual({
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

      await expect(
        client.getToolsByIds({ tool_ids: ['tool-1'] })
      ).rejects.toEqual({
        status: 500,
        message: 'Internal Server Error',
        details: undefined,
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
        })
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
        expect.any(Object)
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
        })
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
    expect(() => createClientFromEnv()).toThrow(
      'QVERIS_API_KEY environment variable is required'
    );
  });
});

