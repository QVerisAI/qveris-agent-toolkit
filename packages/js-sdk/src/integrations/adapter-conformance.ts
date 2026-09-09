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
  getTools: (
    client: FakeQveris,
    options?: { sessionId?: string; model?: string },
  ) => Record<string, { description?: string }>;
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

    it('keeps provider comparison and fresh-call boundaries model-visible', () => {
      const tools = getTools(new FakeQveris());
      expect(tools.qveris_discover.description).toContain(
        'Provider comparison: Inspect each candidate to confirm current scope/contracts.',
      );
      expect(tools.qveris_inspect.description).toContain(
        'If current quotes are required, do not Call until the host obtains them; this three-tool adapter does not expose Probe.',
      );
      expect(tools.qveris_call.description).toContain(
        'Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data.',
      );
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

    it('call forwards configured model attribution only to paid calls', async () => {
      const client = new FakeQveris();
      const tools = getTools(client, { model: 'router-model-v1' });

      await invoke(tools.qveris_discover, { query: 'weather' });
      await invoke(tools.qveris_call, { tool_id: 't1', params_to_tool: {} });

      expect(client.calls[0]).toEqual({ method: 'discover', query: 'weather', options: {} });
      expect(client.calls[1]).toEqual({
        method: 'call',
        toolId: 't1',
        options: { parameters: {}, model: 'router-model-v1' },
      });
    });
  });
}
