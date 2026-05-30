/**
 * Unit tests for the call (execute_tool) MCP tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeExecuteTool, executeToolSchema } from './execute.js';
import { QverisClient } from '../api/client.js';
import type { ExecuteResponse } from '../types.js';

describe('call (execute_tool)', () => {
  describe('executeToolSchema', () => {
    it('should have tool_id, search_id, params_to_tool as required', () => {
      expect(executeToolSchema.required).toContain('tool_id');
      expect(executeToolSchema.required).toContain('search_id');
      expect(executeToolSchema.required).toContain('params_to_tool');
    });

    it('should define tool_id as string', () => {
      expect(executeToolSchema.properties.tool_id.type).toBe('string');
    });

    it('should define search_id as string', () => {
      expect(executeToolSchema.properties.search_id.type).toBe('string');
    });

    it('should define params_to_tool as object', () => {
      expect(executeToolSchema.properties.params_to_tool.type).toBe('object');
    });

    it('should define max_response_size with default', () => {
      expect(executeToolSchema.properties.max_response_size.type).toBe('number');
      expect(executeToolSchema.properties.max_response_size.default).toBe(20480);
    });

    it('should define session_id as optional', () => {
      expect(executeToolSchema.properties.session_id.type).toBe('string');
      expect(executeToolSchema.required).not.toContain('session_id');
    });
  });

  describe('executeExecuteTool', () => {
    let mockClient: QverisClient;
    let executeToolMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      executeToolMock = vi.fn();
      mockClient = {
        executeTool: executeToolMock,
      } as unknown as QverisClient;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should pass object params and call client.executeTool', async () => {
      const mockResponse: ExecuteResponse = {
        execution_id: 'exec-123',
        tool_id: 'weather-tool',
        parameters: { city: 'Tokyo', units: 'metric' },
        success: true,
        result: { data: { temperature: 25, humidity: 60 } },
        created_at: '2025-01-15T10:00:00Z',
      };

      executeToolMock.mockResolvedValueOnce(mockResponse);

      const result = await executeExecuteTool(
        mockClient,
        {
          tool_id: 'weather-tool',
          search_id: 'search-123',
          params_to_tool: { city: 'Tokyo', units: 'metric' },
        },
        'default-session'
      );

      expect(executeToolMock).toHaveBeenCalledWith('weather-tool', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: { city: 'Tokyo', units: 'metric' },
        max_response_size: undefined,
      });

      expect(result).toEqual(mockResponse);
    });

    it('should use provided session_id over default', async () => {
      executeToolMock.mockResolvedValueOnce({
        execution_id: 'exec-123',
        tool_id: 'tool-1',
        parameters: {},
        success: true,
        created_at: '2025-01-15T10:00:00Z',
      });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: {},
          session_id: 'custom-session',
        },
        'default-session'
      );

      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'custom-session',
        parameters: {},
        max_response_size: undefined,
      });
    });

    it('should pass max_response_size when provided', async () => {
      executeToolMock.mockResolvedValueOnce({
        execution_id: 'exec-123',
        tool_id: 'tool-1',
        parameters: {},
        success: true,
        created_at: '2025-01-15T10:00:00Z',
      });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: {},
          max_response_size: 102400,
        },
        'default-session'
      );

      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: {},
        max_response_size: 102400,
      });
    });

    it.each(['not valid json', null, ['city'], new Date('2026-01-01'), new Map([['city', 'London']])])(
      'should reject non-object params_to_tool: %s',
      async (paramsToTool) => {
        await expect(
          executeExecuteTool(
            mockClient,
            {
              tool_id: 'tool-1',
              search_id: 'search-123',
              params_to_tool: paramsToTool as unknown as Record<string, unknown>,
            },
            'default-session'
          )
        ).rejects.toThrow('params_to_tool must be a JSON object');
      }
    );

    it('should allow null-prototype params_to_tool objects', async () => {
      const params = Object.create(null) as Record<string, unknown>;
      params.city = 'London';

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: params,
        },
        'default-session'
      );

      expect(mockClient.executeTool).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: params,
        max_response_size: undefined,
      });
    });

    it('should handle complex nested parameters', async () => {
      const complexParams = {
        filters: {
          category: 'electronics',
          priceRange: { min: 100, max: 500 },
        },
        sort: ['price', 'rating'],
        limit: 10,
      };

      executeToolMock.mockResolvedValueOnce({
        execution_id: 'exec-123',
        tool_id: 'search-products',
        parameters: complexParams,
        success: true,
        created_at: '2025-01-15T10:00:00Z',
      });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'search-products',
          search_id: 'search-123',
          params_to_tool: complexParams,
        },
        'default-session'
      );

      expect(executeToolMock).toHaveBeenCalledWith('search-products', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: complexParams,
        max_response_size: undefined,
      });
    });

    it('should propagate errors from client', async () => {
      const error = { status: 429, message: 'Rate limit exceeded' };
      executeToolMock.mockRejectedValueOnce(error);

      await expect(
        executeExecuteTool(
          mockClient,
          {
            tool_id: 'tool-1',
            search_id: 'search-123',
            params_to_tool: {},
          },
          'session'
        )
      ).rejects.toEqual(error);
    });
  });
});

