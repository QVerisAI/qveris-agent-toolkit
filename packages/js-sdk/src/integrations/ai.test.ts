import { describe, expect, it } from 'vitest';

import { getQverisTools } from './ai.js';

class FakeQveris {
  calls: Array<Record<string, unknown>> = [];

  async discover(query: string, options: Record<string, unknown> = {}) {
    this.calls.push({ method: 'discover', query, options });
    return { search_id: 's1', total: 1, results: [{ tool_id: 't1' }] };
  }

  async inspect(toolIds: string | string[], options: Record<string, unknown> = {}) {
    this.calls.push({ method: 'inspect', toolIds, options });
    return { search_id: 's1', total: 1, results: [{ tool_id: 't1' }] };
  }

  async call(toolId: string, options: Record<string, unknown>) {
    this.calls.push({ method: 'call', toolId, options });
    return { execution_id: 'e1', success: true };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (t: any, args: Record<string, unknown>) =>
  t.execute(args, { toolCallId: 'c1', messages: [] });

describe('getQverisTools (Vercel AI SDK)', () => {
  it('exposes three named tools', () => {
    const tools = getQverisTools(new FakeQveris() as never);
    expect(Object.keys(tools)).toEqual(['qveris_discover', 'qveris_inspect', 'qveris_call']);
    for (const key of Object.keys(tools) as Array<keyof typeof tools>) {
      expect(tools[key].description).toBeTruthy();
    }
  });

  it('discover routes to client.discover with limit and sessionId', async () => {
    const client = new FakeQveris();
    const tools = getQverisTools(client as never, { sessionId: 'sess-1' });

    const out = await invoke(tools.qveris_discover, { query: 'weather forecast API', limit: 3 });

    expect(client.calls[0]).toEqual({
      method: 'discover',
      query: 'weather forecast API',
      options: { limit: 3, sessionId: 'sess-1' },
    });
    expect(out.search_id).toBe('s1');
  });

  it('call maps params_to_tool/search_id and omits max_response_size when absent', async () => {
    const client = new FakeQveris();
    const tools = getQverisTools(client as never);

    const out = await invoke(tools.qveris_call, {
      tool_id: 't1',
      search_id: 's1',
      params_to_tool: { city: 'London' },
    });

    expect(client.calls[0]).toEqual({
      method: 'call',
      toolId: 't1',
      options: { parameters: { city: 'London' }, searchId: 's1' },
    });
    expect('maxResponseSize' in (client.calls[0].options as object)).toBe(false);
    expect(out.execution_id).toBe('e1');
  });

  it('inspect passes tool_ids and searchId', async () => {
    const client = new FakeQveris();
    const tools = getQverisTools(client as never);

    await invoke(tools.qveris_inspect, { tool_ids: ['t1', 't2'], search_id: 's1' });

    expect(client.calls[0]).toEqual({
      method: 'inspect',
      toolIds: ['t1', 't2'],
      options: { searchId: 's1' },
    });
  });
});
