import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeQverisMcpTool, initializeQverisClient, isEntrypoint, listQverisMcpTools } from './index.js';
import type { QverisClient } from './api/client.js';
import { creditsLedgerSchema } from './tools/credits-ledger.js';
import { executeToolSchema } from './tools/execute.js';
import { getToolsByIdsSchema } from './tools/get-by-ids.js';
import { searchToolsSchema } from './tools/search.js';
import { usageHistorySchema } from './tools/usage-history.js';

function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const ORIGINAL_API_KEY = process.env.QVERIS_API_KEY;
const ORIGINAL_BASE_URL = process.env.QVERIS_BASE_URL;

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.QVERIS_API_KEY;
  else process.env.QVERIS_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_BASE_URL === undefined) delete process.env.QVERIS_BASE_URL;
  else process.env.QVERIS_BASE_URL = ORIGINAL_BASE_URL;
  vi.restoreAllMocks();
});

describe('MCP API client initialization', () => {
  it('starts without a client only when the API key is missing', () => {
    delete process.env.QVERIS_API_KEY;
    delete process.env.QVERIS_BASE_URL;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(initializeQverisClient()).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('QVERIS_API_KEY environment variable is required'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Starting without credentials'));
  });

  it('fails startup when a configured API endpoint is invalid', () => {
    process.env.QVERIS_API_KEY = 'sk-test';
    process.env.QVERIS_BASE_URL = 'not-a-url';

    expect(() => initializeQverisClient()).toThrow(/base URL must be a valid HTTP\(S\) URL/);
  });
});

describe('MCP public tool interface', () => {
  it('detects the process entrypoint when npm launches the bin through a symlink', () => {
    // Canonicalize: on macOS tmpdir() sits behind the /var -> /private/var
    // symlink, but Node always reports canonical paths in import.meta.url,
    // which is what the moduleUrl argument simulates.
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'qveris-mcp-entrypoint-')));
    try {
      const realEntrypoint = join(tempDir, 'dist-index.js');
      const symlinkEntrypoint = join(tempDir, 'qveris-mcp');
      writeFileSync(realEntrypoint, '#!/usr/bin/env node\n');

      expect(isEntrypoint(realEntrypoint, pathToFileURL(realEntrypoint).href)).toBe(true);

      try {
        symlinkSync(realEntrypoint, symlinkEntrypoint);
        expect(isEntrypoint(symlinkEntrypoint, pathToFileURL(realEntrypoint).href)).toBe(true);
      } catch (error) {
        if (hasErrorCode(error, 'EPERM')) return;

        throw error;
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to the original entrypoint path when realpath resolution fails', () => {
    const missingEntrypoint = join(tmpdir(), 'qveris-mcp-missing-entrypoint.js');

    expect(isEntrypoint(missingEntrypoint, pathToFileURL(missingEntrypoint).href)).toBe(true);
  });

  it('exposes canonical tools and deprecated aliases with matching schemas', () => {
    const tools = listQverisMcpTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(tools.map((tool) => tool.name)).toEqual([
      'discover',
      'inspect',
      'call',
      'usage_history',
      'credits_ledger',
      'search_tools',
      'get_tools_by_ids',
      'execute_tool',
    ]);

    expect(byName.get('discover')?.inputSchema).toBe(searchToolsSchema);
    expect(byName.get('inspect')?.inputSchema).toBe(getToolsByIdsSchema);
    expect(byName.get('call')?.inputSchema).toBe(executeToolSchema);
    expect(byName.get('usage_history')?.inputSchema).toBe(usageHistorySchema);
    expect(byName.get('credits_ledger')?.inputSchema).toBe(creditsLedgerSchema);

    expect(byName.get('search_tools')?.inputSchema).toBe(searchToolsSchema);
    expect(byName.get('get_tools_by_ids')?.inputSchema).toBe(getToolsByIdsSchema);
    expect(byName.get('execute_tool')?.inputSchema).toBe(executeToolSchema);

    expect(byName.get('search_tools')?.description).toContain('Deprecated');
    expect(byName.get('get_tools_by_ids')?.description).toContain('Deprecated');
    expect(byName.get('execute_tool')?.description).toContain('Deprecated');
  });

  it('routes canonical and deprecated tool calls through the server-level dispatcher', async () => {
    const client = {
      searchTools: vi.fn().mockResolvedValue({ search_id: 'search-1', results: [] }),
      getToolsByIds: vi.fn().mockResolvedValue({ results: [{ tool_id: 'weather.tool.v1' }] }),
      executeTool: vi.fn().mockResolvedValue({ execution_id: 'exec-1', success: true }),
      getUsageHistory: vi.fn(),
      getCreditsLedger: vi.fn(),
    } as unknown as QverisClient;
    const warn = vi.fn();

    const discover = await executeQverisMcpTool(
      client,
      'session-1',
      'search_tools',
      { query: 'weather', limit: 2 },
      warn,
    );
    const inspect = await executeQverisMcpTool(
      client,
      'session-1',
      'inspect',
      { tool_ids: ['weather.tool.v1'], search_id: 'search-1' },
      warn,
    );
    const call = await executeQverisMcpTool(
      client,
      'session-1',
      'call',
      {
        tool_id: 'weather.tool.v1',
        search_id: 'search-1',
        params_to_tool: { city: 'London' },
        max_response_size: 4096,
      },
      warn,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Deprecated'));
    expect(payload(discover).search_id).toBe('search-1');
    expect(payload(inspect).results[0].tool_id).toBe('weather.tool.v1');
    expect(payload(call).execution_id).toBe('exec-1');

    expect(client.searchTools).toHaveBeenCalledWith({
      query: 'weather',
      limit: 2,
      session_id: 'session-1',
    });
    expect(client.getToolsByIds).toHaveBeenCalledWith({
      tool_ids: ['weather.tool.v1'],
      search_id: 'search-1',
      session_id: 'session-1',
    });
    expect(client.executeTool).toHaveBeenCalledWith('weather.tool.v1', {
      search_id: 'search-1',
      session_id: 'session-1',
      parameters: { city: 'London' },
      max_response_size: 4096,
    });
  });

  it('returns an actionable error when called without a client (no QVERIS_API_KEY)', async () => {
    const result = await executeQverisMcpTool(undefined, 'session-1', 'discover', { query: 'weather' });

    expect(result.isError).toBe(true);
    expect(payload(result).error).toContain('QVERIS_API_KEY');
  });

  it('returns MCP error payloads for validation, unknown tools, and API errors', async () => {
    const client = {
      searchTools: vi.fn().mockRejectedValue({
        status: 401,
        message: 'bad key',
        details: { code: 'auth' },
        observability: {
          operation: 'discover',
          endpoint: '/search',
          http_status: 401,
          error_type: 'http_error',
        },
      }),
      getToolsByIds: vi.fn(),
      executeTool: vi.fn(),
      getUsageHistory: vi.fn(),
      getCreditsLedger: vi.fn(),
    } as unknown as QverisClient;

    const missingQuery = await executeQverisMcpTool(client, 'session-1', 'discover', {});
    const missingCallParams = await executeQverisMcpTool(client, 'session-1', 'call', { tool_id: 'weather.tool.v1' });
    const invalidCallParams = await executeQverisMcpTool(client, 'session-1', 'call', {
      tool_id: 'weather.tool.v1',
      search_id: 'search-1',
      params_to_tool: '{"city":"London"}',
    });
    const unknown = await executeQverisMcpTool(client, 'session-1', 'not_a_tool', {});
    const apiError = await executeQverisMcpTool(client, 'session-1', 'discover', { query: 'weather' });

    expect(missingQuery.isError).toBe(true);
    expect(payload(missingQuery).error).toContain('query');
    expect(missingCallParams.isError).toBe(true);
    expect(payload(missingCallParams).error).toContain('search_id');
    expect(invalidCallParams.isError).toBe(true);
    expect(payload(invalidCallParams).error).toContain('JSON object');
    expect(unknown.isError).toBe(true);
    expect(payload(unknown).available_tools).toEqual([
      'discover',
      'inspect',
      'call',
      'usage_history',
      'credits_ledger',
    ]);
    expect(apiError.isError).toBe(true);
    expect(payload(apiError)).toMatchObject({
      error: 'bad key',
      status: 401,
      details: { code: 'auth' },
      observability: {
        source: 'qveris_mcp',
        requested_tool: 'discover',
        mcp_tool: 'discover',
        session_id: 'session-1',
        query: 'weather',
        api: {
          operation: 'discover',
          endpoint: '/search',
          http_status: 401,
          error_type: 'http_error',
        },
      },
    });
  });

  it('adds tool and provider observability to failed call payloads', async () => {
    const client = {
      searchTools: vi.fn(),
      getToolsByIds: vi.fn(),
      executeTool: vi.fn().mockRejectedValue({
        status: 0,
        message: 'fetch failed',
        cause: 'ECONNRESET',
        observability: {
          operation: 'call',
          endpoint: '/tools/execute?tool_id=weather.forecast.v1',
          http_status: 0,
          error_type: 'network_error',
        },
      }),
      getUsageHistory: vi.fn(),
      getCreditsLedger: vi.fn(),
    } as unknown as QverisClient;

    const result = await executeQverisMcpTool(client, 'session-1', 'call', {
      tool_id: 'weather.forecast.v1',
      search_id: 'search-1',
      params_to_tool: { city: 'London' },
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      error: 'fetch failed',
      status: 0,
      cause: 'ECONNRESET',
      observability: {
        source: 'qveris_mcp',
        requested_tool: 'call',
        mcp_tool: 'call',
        session_id: 'session-1',
        search_id: 'search-1',
        tool_id: 'weather.forecast.v1',
        provider_id: 'weather',
        api: {
          operation: 'call',
          endpoint: '/tools/execute?tool_id=weather.forecast.v1',
          http_status: 0,
          error_type: 'network_error',
        },
      },
    });
  });
});

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
