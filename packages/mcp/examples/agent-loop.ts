/**
 * Agent loop over the QVeris MCP server.
 *
 * Spawns `@qverisai/mcp` as a subprocess and speaks MCP to it over stdio —
 * exactly how an agent runtime (Claude Desktop, Codex, a custom host) drives
 * the server. It lists the tools, then runs the discover -> inspect -> call
 * loop the same way a model would by calling the exposed tools.
 *
 * The server starts even without QVERIS_API_KEY (tool listing works; calls
 * return an actionable error), so this is safe to run unconfigured. The `call`
 * step is additionally gated behind RUN_QVERIS_CALLS=1 to avoid spending
 * credits.
 *
 *   npx tsx examples/agent-loop.ts
 *   QVERIS_API_KEY=sk-... npx tsx examples/agent-loop.ts
 *   QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 npx tsx examples/agent-loop.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type DiscoverResult = { search_id?: string; results?: Array<{ tool_id: string; name?: string }> };
type InspectResult = { results?: Array<{ params?: Array<{ name?: string }> }> };
type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

/** Forward only defined environment variables (the transport wants string values). */
function childEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * Read a tool result as typed data. Prefer `structuredContent` (present when the
 * tool declares an outputSchema, as QVeris's do), and fall back to parsing the
 * text block so the example stays robust against servers that omit it.
 */
function readResult<T>(result: ToolCallResult): T | undefined {
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T;
  }
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (first?.type === 'text') {
    return JSON.parse(first.text) as T;
  }
  return undefined;
}

async function main(): Promise<void> {
  const hasKey = Boolean(process.env.QVERIS_API_KEY);

  // The subprocess inherits QVERIS_API_KEY through its environment. Override the
  // command to test a local build, e.g.
  // QVERIS_MCP_COMMAND=node QVERIS_MCP_ARGS=dist/index.js.
  const transport = new StdioClientTransport({
    command: process.env.QVERIS_MCP_COMMAND ?? 'npx',
    args: process.env.QVERIS_MCP_ARGS ? process.env.QVERIS_MCP_ARGS.split(' ') : ['-y', '@qverisai/mcp'],
    env: childEnv(),
  });
  const client = new Client({ name: 'qveris-agent-loop-example', version: '0.1.0' });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    console.log(`tools: ${tools.map((tool) => tool.name).join(', ')}`);

    if (!hasKey) {
      console.log('Set QVERIS_API_KEY to run the discover -> inspect -> call loop.');
      return;
    }

    // 1. discover — the model finds candidates from a natural-language query.
    const discovered = await client.callTool({
      name: 'discover',
      arguments: { query: 'public company stock quote and market data API', limit: 5 },
    });
    const found = readResult<DiscoverResult>(discovered);
    const top = found?.results?.[0];
    console.log(`search_id: ${found?.search_id ?? 'n/a'}; matches: ${found?.results?.length ?? 0}`);
    if (!top) return;

    // 2. inspect — read the current parameter schema before calling.
    const inspected = await client.callTool({
      name: 'inspect',
      arguments: { tool_ids: [top.tool_id], search_id: found?.search_id },
    });
    const detail = readResult<InspectResult>(inspected)?.results?.[0];
    const paramNames =
      (detail?.params ?? [])
        .map((param) => param.name)
        .filter(Boolean)
        .join(', ') || 'none';
    console.log(`selected: ${top.tool_id} - ${top.name ?? 'unnamed'} (params: ${paramNames})`);

    if (process.env.RUN_QVERIS_CALLS !== '1') {
      console.log('Set RUN_QVERIS_CALLS=1 to execute the selected capability.');
      return;
    }

    // 3. call — execute the capability. May consume credits.
    const executed = await client.callTool({
      name: 'call',
      arguments: { tool_id: top.tool_id, search_id: found?.search_id, params_to_tool: { symbol: 'AAPL' } },
    });
    console.log(`result: ${JSON.stringify(executed.structuredContent ?? executed.content)}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
