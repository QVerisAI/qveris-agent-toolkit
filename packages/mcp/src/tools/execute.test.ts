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
      expect(executeToolSchema.properties.max_response_size.anyOf).toEqual([
        { const: -1 },
        { type: 'integer', minimum: 1 },
      ]);
      expect(executeToolSchema.properties.max_response_size.default).toBe(20480);
    });

    it('should define session_id as optional', () => {
      expect(executeToolSchema.properties.session_id.type).toBe('string');
      expect(executeToolSchema.required).not.toContain('session_id');
    });

    it('should define model as an optional bounded string', () => {
      expect(executeToolSchema.properties.model.type).toBe('string');
      expect(executeToolSchema.properties.model.maxLength).toBe(128);
      expect(executeToolSchema.required).not.toContain('model');
    });

    it('should define respond_with as an optional projection', () => {
      expect(executeToolSchema.properties.respond_with.pattern).toBe('^(full|summary|fields:.+)$');
      expect(executeToolSchema.required).not.toContain('respond_with');
      expect(executeToolSchema.properties.respond_with.description).toContain('compatibility auto-delivery');
      expect(executeToolSchema.properties.max_response_size.description).toContain('UTF-8 bytes');
    });

    it('should expose the server-enforced zero-quote option', () => {
      expect(executeToolSchema.properties.require_zero_quote.type).toBe('boolean');
      expect(executeToolSchema.required).not.toContain('require_zero_quote');
    });
  });

  describe('executeExecuteTool', () => {
    let mockClient: QverisClient;
    let executeToolMock: ReturnType<typeof vi.fn>;
    let probeToolMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      executeToolMock = vi.fn();
      probeToolMock = vi.fn();
      mockClient = {
        executeTool: executeToolMock,
        probeTool: probeToolMock,
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
        'default-session',
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
        'default-session',
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
        'default-session',
      );

      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: {},
        max_response_size: 102400,
      });
    });

    it('should pass respond_with when provided', async () => {
      executeToolMock.mockResolvedValueOnce({
        execution_id: 'exec-summary',
        success: true,
        result: { respond_with: 'summary' },
      });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: {},
          respond_with: 'summary',
        },
        'default-session',
      );

      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: {},
        max_response_size: undefined,
        respond_with: 'summary',
      });
    });

    it('should pass explicit full with a finite limit exactly once', async () => {
      executeToolMock.mockResolvedValueOnce({
        execution_id: 'exec-full',
        success: true,
        result: { data: { complete: true } },
      });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: {},
          respond_with: 'full',
          max_response_size: 1024,
        },
        'default-session',
      );

      expect(executeToolMock).toHaveBeenCalledTimes(1);
      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: {},
        max_response_size: 1024,
        respond_with: 'full',
      });
    });

    it('should pass model attribution when provided', async () => {
      executeToolMock.mockResolvedValueOnce({ execution_id: 'exec-model', success: true });

      await executeExecuteTool(
        mockClient,
        {
          tool_id: 'tool-1',
          search_id: 'search-123',
          params_to_tool: {},
          model: 'router-model-v1',
        },
        'default-session',
      );

      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-123',
        session_id: 'default-session',
        parameters: {},
        max_response_size: undefined,
        model: 'router-model-v1',
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
            'default-session',
          ),
        ).rejects.toThrow('params_to_tool must be a JSON object');
      },
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
        'default-session',
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
        'default-session',
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
          'session',
        ),
      ).rejects.toEqual(error);
    });

    it('probes exact zero and sends the top-level server guard before a guarded call', async () => {
      probeToolMock.mockResolvedValueOnce({
        executable: true,
        execution_constraints_supported: ['require_zero_quote_v1'],
        schema: { valid: true },
        quote: { exact: true, estimate_credits: 0, currency: 'credits' },
      });
      executeToolMock.mockResolvedValueOnce({ execution_id: 'exec-zero', success: true });

      await executeExecuteTool(
        mockClient,
        { tool_id: 'tool-1', search_id: 'search-1', params_to_tool: { city: 'London' }, require_zero_quote: true },
        'session-1',
      );

      expect(probeToolMock).toHaveBeenCalledWith('tool-1', {
        parameters: { city: 'London' },
        checks: ['schema', 'quote'],
        live_budget: 'none',
      });
      expect(executeToolMock).toHaveBeenCalledWith('tool-1', {
        search_id: 'search-1',
        session_id: 'session-1',
        parameters: { city: 'London' },
        max_response_size: undefined,
        require_zero_quote: true,
      });
    });

    it('keeps idempotency keys out of model-facing call schema and rejects explicit injection', async () => {
      expect(executeToolSchema.properties).not.toHaveProperty('idempotency_key');
      executeToolMock.mockResolvedValueOnce({ execution_id: 'exec-1', success: true });
      await expect(
        executeExecuteTool(
          mockClient,
          {
            tool_id: 'tool-1',
            search_id: 'search-1',
            params_to_tool: { city: 'London' },
            idempotency_key: 'model-chosen-key',
          } as never,
          'session-1',
        ),
      ).rejects.toThrow(/host-controlled transport metadata/);
      expect(executeToolMock).not.toHaveBeenCalled();
    });

    it('fails closed before execute when the quote is positive or inexact', async () => {
      probeToolMock.mockResolvedValueOnce({
        executable: true,
        execution_constraints_supported: ['require_zero_quote_v1'],
        schema: { valid: true },
        quote: { exact: false, estimate_credits: 0, currency: 'credits' },
      });

      await expect(
        executeExecuteTool(
          mockClient,
          { tool_id: 'tool-1', search_id: 'search-1', params_to_tool: {}, require_zero_quote: true },
          'session-1',
        ),
      ).rejects.toThrow(/exact zero-credit quote/);
      expect(executeToolMock).not.toHaveBeenCalled();
    });

    it('fails closed when Probe does not advertise the server zero-quote contract', async () => {
      probeToolMock.mockResolvedValueOnce({
        executable: true,
        execution_constraints_supported: [],
        schema: { valid: true },
        quote: { exact: true, estimate_credits: 0, currency: 'credits' },
      });

      await expect(
        executeExecuteTool(
          mockClient,
          { tool_id: 'tool-1', search_id: 'search-1', params_to_tool: {}, require_zero_quote: true },
          'session-1',
        ),
      ).rejects.toThrow(/exact zero-credit quote/);
      expect(executeToolMock).not.toHaveBeenCalled();
    });
  });
});
