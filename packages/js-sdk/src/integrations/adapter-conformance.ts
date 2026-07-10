/**
 * Shared conformance suite for JS framework adapters.
 *
 * Every adapter that exposes the QVeris workflow as framework tools must hold
 * the same invariants (mirroring the Python `adapter_conformance` suite):
 * three named tools, session threading, optional-argument omission, and an
 * upfront client check. New adapters call
 * {@link describeQverisAdapterConformance} from their test file and inherit
 * the suite, so semantic drift between adapters fails tests instead of
 * shipping.
 *
 * @module integrations/adapter-conformance (test-only)
 */

import { describe, expect, it } from 'vitest';

/** Records client calls and returns canned payloads. */
export class FakeQveris {
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

export interface AdapterConformanceOptions {
  /** Display name for the describe block. */
  adapterName: string;
  /** The adapter's getQverisTools(client, options?). */
  getTools: (client: FakeQveris, options?: { sessionId?: string }) => Record<string, { description?: string }>;
  /** Invoke a tool produced by the adapter with raw tool arguments. */
  invoke: (tool: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

export function describeQverisAdapterConformance(opts: AdapterConformanceOptions): void {
  const { adapterName, getTools, invoke } = opts;

  describe(`${adapterName} adapter conformance`, () => {
    it('exposes exactly the three named tools with descriptions', () => {
      const tools = getTools(new FakeQveris());
      expect(Object.keys(tools)).toEqual(['qveris_discover', 'qveris_inspect', 'qveris_call']);
      for (const tool of Object.values(tools)) {
        expect(tool.description).toBeTruthy();
      }
    });

    it('requires a valid client', () => {
      expect(() => getTools(undefined as never)).toThrow();
      expect(() => getTools({} as never)).toThrow();
    });

    it('discover routes with limit and threads sessionId', async () => {
      const client = new FakeQveris();
      const tools = getTools(client, { sessionId: 'sess-1' });

      await invoke(tools.qveris_discover, { query: 'weather forecast API', limit: 3 });

      expect(client.calls[0]).toEqual({
        method: 'discover',
        query: 'weather forecast API',
        options: { limit: 3, sessionId: 'sess-1' },
      });
    });

    it('inspect passes tool ids and search id', async () => {
      const client = new FakeQveris();
      const tools = getTools(client);

      await invoke(tools.qveris_inspect, { tool_ids: ['t1', 't2'], search_id: 's1' });

      expect(client.calls[0]).toEqual({
        method: 'inspect',
        toolIds: ['t1', 't2'],
        options: { searchId: 's1' },
      });
    });

    it('call threads ids and omits absent maxResponseSize', async () => {
      const client = new FakeQveris();
      const tools = getTools(client);

      await invoke(tools.qveris_call, {
        tool_id: 't1',
        search_id: 's1',
        params_to_tool: { city: 'London' },
      });

      expect(client.calls[0]).toEqual({
        method: 'call',
        toolId: 't1',
        options: { parameters: { city: 'London' }, searchId: 's1' },
      });
    });

    it('call omits absent search_id and defaults params to {}', async () => {
      const client = new FakeQveris();
      const tools = getTools(client);

      await invoke(tools.qveris_call, { tool_id: 't1' });

      expect(client.calls[0]).toEqual({
        method: 'call',
        toolId: 't1',
        options: { parameters: {} },
      });
    });

    it('call forwards maxResponseSize when given', async () => {
      const client = new FakeQveris();
      const tools = getTools(client);

      await invoke(tools.qveris_call, {
        tool_id: 't1',
        search_id: 's1',
        params_to_tool: {},
        max_response_size: 2048,
      });

      expect((client.calls[0].options as Record<string, unknown>).maxResponseSize).toBe(2048);
    });
  });
}
