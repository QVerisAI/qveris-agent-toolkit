import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { QverisClient } from './api/client.js';
import { executeExecuteTool, executeToolSchema, type ExecuteToolInput } from './tools/execute.js';
import { executeProbeTool, probeToolSchema, type ProbeToolInput } from './tools/probe.js';

interface RequestContract {
  body: Record<string, unknown>;
  mcp: Record<string, string>;
}
const contracts = JSON.parse(
  readFileSync(new URL('../../../contracts/public-client-requests.v1.json', import.meta.url), 'utf8'),
) as Record<'call' | 'probe', RequestContract>;
afterEach(() => vi.unstubAllGlobals());

test.each(['call', 'probe'] as const)(
  '%s exposes and forwards every public field through the complete MCP path',
  async (operation) => {
    const contract = contracts[operation];
    const schema = operation === 'call' ? executeToolSchema : probeToolSchema;
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['tool_id', ...Object.keys(contract.body).map((key) => contract.mcp[key] ?? key)].sort(),
    );
    for (const identity of [undefined, 'tenant-user-fixture', '用户/tenant-A']) {
      const body = { ...contract.body };
      if (identity === undefined) delete body.sub_user_id;
      else body.sub_user_id = identity;
      const input = {
        tool_id: 'tool/fixture',
        ...Object.fromEntries(Object.entries(body).map(([key, value]) => [contract.mcp[key] ?? key, value])),
      };
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ execution_id: 'exec-fixture', success: true, result: {} }), { status: 200 }),
        );
      vi.stubGlobal('fetch', fetch);
      const client = new QverisClient({ apiKey: '<fixture-key>', baseUrl: 'https://qveris.ai/api/v1' });
      if (operation === 'call')
        await executeExecuteTool(client, input as unknown as ExecuteToolInput, 'fallback-session');
      else await executeProbeTool(client, input as ProbeToolInput);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).searchParams.get('tool_id')).toBe('tool/fixture');
      expect(JSON.parse(init.body as string)).toEqual(body);
    }
  },
);
