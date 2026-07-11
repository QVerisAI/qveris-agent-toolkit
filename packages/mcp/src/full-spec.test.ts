import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createQverisServer } from './index.js';
import type { QverisClient } from './api/client.js';

/** Client-shaped fake covering the methods the tool executors use. */
function fakeQverisClient() {
  return {
    calls: [] as string[],
    async searchTools() {
      this.calls.push('search');
      return { search_id: 's1', total: 1, results: [{ tool_id: 't1', name: 'T', description: 'd' }] };
    },
    async getToolsByIds() {
      this.calls.push('inspect');
      return { search_id: 's1', results: [{ tool_id: 't1', name: 'T', description: 'd' }] };
    },
    async executeTool() {
      this.calls.push('execute');
      return { execution_id: 'e1', success: true, result: { ok: 1 } };
    },
  } as unknown as QverisClient & { calls: string[] };
}

async function connect(opts: { client?: QverisClient; elicitHandler?: (msg: string) => Promise<boolean> } = {}) {
  const server = createQverisServer(opts.client, 'session-1');
  const capabilities = opts.elicitHandler ? { elicitation: { form: {} } } : {};
  const mcpClient = new Client({ name: 'full-spec-test', version: '0.0.0' }, { capabilities });
  if (opts.elicitHandler) {
    const handler = opts.elicitHandler;
    mcpClient.setRequestHandler(ElicitRequestSchema, async (request) => {
      const confirm = await handler(request.params.message);
      return { action: confirm ? 'accept' : 'decline', content: confirm ? { confirm: true } : undefined };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

describe('output schemas + structured content', () => {
  it('declares outputSchema on all five canonical tools', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    for (const name of ['discover', 'inspect', 'call', 'usage_history', 'credits_ledger']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.outputSchema, `${name} outputSchema`).toBeDefined();
      expect((tool?.outputSchema as { additionalProperties?: boolean }).additionalProperties).toBe(true);
    }
    await c.close();
  });

  it('returns structuredContent alongside the JSON text', async () => {
    const c = await connect({ client: fakeQverisClient() });
    const result = await c.callTool({ name: 'discover', arguments: { query: 'weather' } });
    expect(result.structuredContent).toMatchObject({ search_id: 's1' });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).search_id).toBe('s1');
    await c.close();
  });
});

describe('elicitation billing consent (QVERIS_MCP_CONFIRM_CALLS)', () => {
  const OLD = process.env.QVERIS_MCP_CONFIRM_CALLS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.QVERIS_MCP_CONFIRM_CALLS;
    else process.env.QVERIS_MCP_CONFIRM_CALLS = OLD;
  });

  it('proceeds when the user accepts', async () => {
    process.env.QVERIS_MCP_CONFIRM_CALLS = 'true';
    const qveris = fakeQverisClient();
    const seen: string[] = [];
    const c = await connect({
      client: qveris,
      elicitHandler: async (msg) => {
        seen.push(msg);
        return true;
      },
    });
    const result = await c.callTool({
      name: 'call',
      arguments: { tool_id: 't1', search_id: 's1', params_to_tool: {} },
    });
    expect(result.isError).toBeFalsy();
    expect(qveris.calls).toContain('execute');
    expect(seen[0]).toContain('t1'); // the consent prompt names the capability
    await c.close();
  });

  it('cancels the charged call when the user declines', async () => {
    process.env.QVERIS_MCP_CONFIRM_CALLS = 'true';
    const qveris = fakeQverisClient();
    const c = await connect({ client: qveris, elicitHandler: async () => false });
    const result = await c.callTool({
      name: 'call',
      arguments: { tool_id: 't1', search_id: 's1', params_to_tool: {} },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('declined');
    expect(qveris.calls).not.toContain('execute'); // nothing was charged
    await c.close();
  });

  it('does not elicit when the flag is off', async () => {
    delete process.env.QVERIS_MCP_CONFIRM_CALLS;
    const qveris = fakeQverisClient();
    let asked = false;
    const c = await connect({
      client: qveris,
      elicitHandler: async () => {
        asked = true;
        return true;
      },
    });
    await c.callTool({ name: 'call', arguments: { tool_id: 't1', search_id: 's1', params_to_tool: {} } });
    expect(asked).toBe(false);
    expect(qveris.calls).toContain('execute');
    await c.close();
  });

  it('proceeds without consent when the client lacks elicitation support', async () => {
    process.env.QVERIS_MCP_CONFIRM_CALLS = 'true';
    const qveris = fakeQverisClient();
    const c = await connect({ client: qveris }); // no elicitation capability
    const result = await c.callTool({
      name: 'call',
      arguments: { tool_id: 't1', search_id: 's1', params_to_tool: {} },
    });
    expect(result.isError).toBeFalsy();
    expect(qveris.calls).toContain('execute');
    await c.close();
  });
});

describe('resources: server card + capability metadata', () => {
  it('lists the server card resource and the capability template', async () => {
    const c = await connect();
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toContain('qveris://server-card');
    const { resourceTemplates } = await c.listResourceTemplates();
    expect(resourceTemplates[0].uriTemplate).toBe('qveris://capability/{tool_id}');
    await c.close();
  });

  it('reads the server card with the SEP media type', async () => {
    const c = await connect();
    const { contents } = await c.readResource({ uri: 'qveris://server-card' });
    expect(contents[0].mimeType).toBe('application/mcp-server-card+json');
    const card = JSON.parse(contents[0].text as string);
    expect(card.name).toBe('io.github.QVerisAI/mcp');
    expect(card.$schema).toContain('server-card.schema.json');
    await c.close();
  });

  it('reads capability metadata through the client', async () => {
    const qveris = fakeQverisClient();
    const c = await connect({ client: qveris });
    const { contents } = await c.readResource({ uri: 'qveris://capability/t1' });
    expect(JSON.parse(contents[0].text as string).results[0].tool_id).toBe('t1');
    await c.close();
  });

  it('gives an actionable error for capability reads without an API key', async () => {
    const c = await connect(); // keyless
    await expect(c.readResource({ uri: 'qveris://capability/t1' })).rejects.toThrow(/QVERIS_API_KEY/);
    await c.close();
  });
});
