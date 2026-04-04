/**
 * Unit tests for the get_tools_by_ids MCP tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeGetToolsByIds, getToolsByIdsSchema } from './get-by-ids.js';
import { QverisClient } from '../api/client.js';
import type { SearchResponse } from '../types.js';

describe('get_tools_by_ids', () => {
  describe('getToolsByIdsSchema', () => {
    it('should have tool_ids as required parameter', () => {
      expect(getToolsByIdsSchema.required).toContain('tool_ids');
    });

    it('should define tool_ids as array of strings', () => {
      expect(getToolsByIdsSchema.properties.tool_ids.type).toBe('array');
      expect(getToolsByIdsSchema.properties.tool_ids.items.type).toBe('string');
      expect(getToolsByIdsSchema.properties.tool_ids.minItems).toBe(1);
    });

    it('should define search_id as optional string', () => {
      expect(getToolsByIdsSchema.properties.search_id.type).toBe('string');
      expect(getToolsByIdsSchema.required).not.toContain('search_id');
    });

    it('should define session_id as optional string', () => {
      expect(getToolsByIdsSchema.properties.session_id.type).toBe('string');
      expect(getToolsByIdsSchema.required).not.toContain('session_id');
    });
  });

  describe('executeGetToolsByIds', () => {
    let mockClient: QverisClient;
    let getToolsByIdsMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      getToolsByIdsMock = vi.fn();
      mockClient = {
        getToolsByIds: getToolsByIdsMock,
      } as unknown as QverisClient;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call client.getToolsByIds with correct parameters', async () => {
      const mockResponse: SearchResponse = {
        search_id: 'search-123',
        results: [
          {
            tool_id: 'weather-tool-1',
            name: 'Weather API',
            description: 'Get weather data',
          },
          {
            tool_id: 'email-tool-2',
            name: 'Email Service',
            description: 'Send emails',
          },
        ],
        total: 2,
      };

      getToolsByIdsMock.mockResolvedValueOnce(mockResponse);

      const result = await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: ['weather-tool-1', 'email-tool-2'],
          search_id: 'search-123',
        },
        'default-session'
      );

      expect(getToolsByIdsMock).toHaveBeenCalledWith({
        tool_ids: ['weather-tool-1', 'email-tool-2'],
        search_id: 'search-123',
        session_id: 'default-session',
      });

      expect(result).toEqual(mockResponse);
    });

    it('should use default session_id when not provided', async () => {
      getToolsByIdsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: [
          {
            tool_id: 'tool-1',
            name: 'Tool 1',
            description: 'Description 1',
          },
        ],
      });

      await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: ['tool-1'],
        },
        'default-session'
      );

      expect(getToolsByIdsMock).toHaveBeenCalledWith({
        tool_ids: ['tool-1'],
        search_id: undefined,
        session_id: 'default-session',
      });
    });

    it('should use provided session_id over default', async () => {
      getToolsByIdsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: [],
      });

      await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: ['tool-1'],
          session_id: 'custom-session',
        },
        'default-session'
      );

      expect(getToolsByIdsMock).toHaveBeenCalledWith({
        tool_ids: ['tool-1'],
        search_id: undefined,
        session_id: 'custom-session',
      });
    });

    it('should include search_id when provided', async () => {
      getToolsByIdsMock.mockResolvedValueOnce({
        search_id: 'search-456',
        results: [],
      });

      await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: ['tool-1', 'tool-2'],
          search_id: 'search-456',
        },
        'default-session'
      );

      expect(getToolsByIdsMock).toHaveBeenCalledWith({
        tool_ids: ['tool-1', 'tool-2'],
        search_id: 'search-456',
        session_id: 'default-session',
      });
    });

    it('should handle single tool ID', async () => {
      getToolsByIdsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: [
          {
            tool_id: 'single-tool',
            name: 'Single Tool',
            description: 'A single tool',
          },
        ],
        total: 1,
      });

      const result = await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: ['single-tool'],
        },
        'default-session'
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].tool_id).toBe('single-tool');
    });

    it('should handle multiple tool IDs', async () => {
      const toolIds = ['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5'];
      getToolsByIdsMock.mockResolvedValueOnce({
        search_id: 'search-123',
        results: toolIds.map((id) => ({
          tool_id: id,
          name: `Tool ${id}`,
          description: `Description for ${id}`,
        })),
        total: toolIds.length,
      });

      const result = await executeGetToolsByIds(
        mockClient,
        {
          tool_ids: toolIds,
        },
        'default-session'
      );

      expect(result.results).toHaveLength(5);
      expect(result.total).toBe(5);
    });

    it('should propagate errors from client', async () => {
      const error = { status: 404, message: 'Tool not found' };
      getToolsByIdsMock.mockRejectedValueOnce(error);

      await expect(
        executeGetToolsByIds(
          mockClient,
          { tool_ids: ['non-existent-tool'] },
          'session'
        )
      ).rejects.toEqual(error);
    });
  });
});

