import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { getQverisTools } from './ai.js';
import { describeQverisAdapterConformance, FakeQveris } from './adapter-conformance.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (t: any, args: Record<string, unknown>) => t.execute(args, { toolCallId: 'c1', messages: [] });

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
      const properties = z.toJSONSchema(tool.inputSchema as z.ZodObject).properties;
      expect(properties).not.toHaveProperty('sub_user_id');
      expect(properties).not.toHaveProperty('subUserId');
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

it('exposes Probe only when enabled and binds host identity outside the model schema', async () => {
  const client = new FakeQveris() as FakeQveris & { probe: ReturnType<typeof vi.fn> };
  client.probe = vi.fn().mockResolvedValue({ schema: { valid: true }, quote: { exact: false } });
  expect(Object.keys(getQverisTools(client as never))).toHaveLength(3);
  const tools = getQverisTools(client as never, { includeProbe: true, subUserId: 'host-user' });
  expect(Object.keys(tools)).toHaveLength(4);
  if (!('qveris_probe' in tools)) throw new Error('Probe missing');
  expect(tools.qveris_probe.inputSchema.safeParse({ tool_id: 't1', checks: ['invalid'] }).success).toBe(false);
  expect(tools.qveris_probe.inputSchema.safeParse({ tool_id: 't1', checks: [] }).success).toBe(false);
  await invoke(tools.qveris_probe, {
    tool_id: 't1',
    parameters: { city: 'London' },
    checks: ['quote'],
    live_budget: 'metadata',
    sub_user_id: 'model-user',
  });
  expect(client.probe).toHaveBeenCalledWith('t1', {
    parameters: { city: 'London' },
    checks: ['quote'],
    liveBudget: 'metadata',
    subUserId: 'host-user',
  });
  expect(tools.qveris_discover.description).toContain('use qveris_probe');
  expect(tools.qveris_discover.description).not.toContain('does not expose Probe');
});
