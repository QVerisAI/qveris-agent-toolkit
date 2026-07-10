import { describe, expect, it } from 'vitest';

import { getQverisTools } from './ai.js';
import { describeQverisAdapterConformance, FakeQveris } from './adapter-conformance.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (t: any, args: Record<string, unknown>) =>
  t.execute(args, { toolCallId: 'c1', messages: [] });

// Shared invariants — mirrors the Python adapter_conformance suite.
describeQverisAdapterConformance({
  adapterName: 'Vercel AI SDK',
  getTools: (client, options) => getQverisTools(client as never, options),
  invoke,
});

// --- Vercel-AI-specific behavior ----------------------------------------------

describe('getQverisTools (Vercel AI SDK specifics)', () => {
  it('tools declare v7 inputSchema (not the legacy parameters field)', () => {
    const tools = getQverisTools(new FakeQveris() as never);
    for (const tool of Object.values(tools)) {
      expect((tool as { inputSchema?: unknown }).inputSchema).toBeDefined();
    }
  });

  it('results pass through the client payload', async () => {
    const client = new FakeQveris();
    const tools = getQverisTools(client as never);

    const out = await invoke(tools.qveris_discover, { query: 'weather forecast API' });
    expect(out.search_id).toBe('s1');

    const outcome = await invoke(tools.qveris_call, {
      tool_id: 't1',
      search_id: 's1',
      params_to_tool: {},
    });
    expect(outcome.execution_id).toBe('e1');
  });
});
