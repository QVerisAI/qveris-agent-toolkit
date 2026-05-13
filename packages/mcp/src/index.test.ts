import { describe, expect, it, vi } from 'vitest';

import { executeQverisMcpTool, listQverisMcpTools } from './index.js';
import type { QverisClient } from './api/client.js';
import { creditsLedgerSchema } from './tools/credits-ledger.js';
import { executeToolSchema } from './tools/execute.js';
import { getToolsByIdsSchema } from './tools/get-by-ids.js';
import { searchToolsSchema } from './tools/search.js';
import { usageHistorySchema } from './tools/usage-history.js';

function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe('MCP public tool interface', () => {
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

  it('returns MCP error payloads for validation, unknown tools, and API errors', async () => {
    const client = {
      searchTools: vi.fn().mockRejectedValue({ status: 401, message: 'bad key', details: { code: 'auth' } }),
      getToolsByIds: vi.fn(),
      executeTool: vi.fn(),
      getUsageHistory: vi.fn(),
      getCreditsLedger: vi.fn(),
    } as unknown as QverisClient;

    const missingQuery = await executeQverisMcpTool(client, 'session-1', 'discover', {});
    const missingCallParams = await executeQverisMcpTool(
      client,
      'session-1',
      'call',
      { tool_id: 'weather.tool.v1' },
    );
    const unknown = await executeQverisMcpTool(client, 'session-1', 'not_a_tool', {});
    const apiError = await executeQverisMcpTool(
      client,
      'session-1',
      'discover',
      { query: 'weather' },
    );

    expect(missingQuery.isError).toBe(true);
    expect(payload(missingQuery).error).toContain('query');
    expect(missingCallParams.isError).toBe(true);
    expect(payload(missingCallParams).error).toContain('search_id');
    expect(unknown.isError).toBe(true);
    expect(payload(unknown).available_tools).toEqual([
      'discover',
      'inspect',
      'call',
      'usage_history',
      'credits_ledger',
    ]);
    expect(apiError.isError).toBe(true);
    expect(payload(apiError)).toEqual({
      error: 'bad key',
      status: 401,
      details: { code: 'auth' },
    });
  });
});
