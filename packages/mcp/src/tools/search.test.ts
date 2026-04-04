/**
 * Unit tests for the search_tools MCP tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeSearchTools, searchToolsSchema } from './search.js';
import { QverisClient } from '../api/client.js';
import type { SearchResponse } from '../types.js';

describe('search_tools', () => {
  describe('searchToolsSchema', () => {
    it('should have query as required parameter', () => {
      expect(searchToolsSchema.required).toContain('query');
    });

    it('should define query as string type', () => {
      expect(searchToolsSchema.properties.query.type).toBe('string');
    });

    it('should define limit with constraints', () => {
      expect(searchToolsSchema.properties.limit.type).toBe('number');
      expect(searchToolsSchema.properties.limit.default).toBe(20);
      expect(searchToolsSchema.properties.limit.minimum).toBe(1);
      expect(searchToolsSchema.properties.limit.maximum).toBe(100);
    });

    it('should define session_id as optional string', () => {
      expect(searchToolsSchema.properties.session_id.type).toBe('string');
      expect(searchToolsSchema.required).not.toContain('session_id');
    });
  });

  describe('executeSearchTools', () => {
    let mockClient: QverisClient;
    let searchToolsMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      searchToolsMock = vi.fn();
      mockClient = {
        searchTools: searchToolsMock,
      } as unknown as QverisClient;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call client.searchTools with correct parameters', async () => {
      const mockResponse: SearchResponse = {
        search_id: 'search-123',
        results: [
          {
            tool_id: 'weather-1',
            name: 'Weather API',
            description: 'Get weather data',
          },
        ],
        total: 1,
      };

      searchToolsMock.mockResolvedValueOnce(mockResponse);

      const result = await executeSearchTools(
        mockClient,
        { query: 'weather API', limit: 5 },
        'default-session'
      );

      expect(searchToolsMock).toHaveBeenCalledWith({
        query: 'weather API',
        limit: 5,
        session_id: 'default-session',
      });

      expect(result).toEqual(mockResponse);
    });

    it('should use default limit of 20 when not provided', async () => {
      searchToolsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: [],
      });

      await executeSearchTools(
        mockClient,
        { query: 'test' },
        'default-session'
      );

      expect(searchToolsMock).toHaveBeenCalledWith({
        query: 'test',
        limit: 20,
        session_id: 'default-session',
      });
    });

    it('should use provided session_id over default', async () => {
      searchToolsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: [],
      });

      await executeSearchTools(
        mockClient,
        { query: 'test', session_id: 'custom-session' },
        'default-session'
      );

      expect(searchToolsMock).toHaveBeenCalledWith({
        query: 'test',
        limit: 20,
        session_id: 'custom-session',
      });
    });

    it('should propagate errors from client', async () => {
      const error = { status: 500, message: 'Server error' };
      searchToolsMock.mockRejectedValueOnce(error);

      await expect(
        executeSearchTools(mockClient, { query: 'test' }, 'session')
      ).rejects.toEqual(error);
    });
  });
});

