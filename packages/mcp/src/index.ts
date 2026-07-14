#!/usr/bin/env node
/**
 * Qveris MCP Server
 *
 * A Model Context Protocol (MCP) server that provides access to the Qveris
 * tool discovery and execution API. Enables LLMs to dynamically search for
 * and execute third-party tools via natural language.
 *
 * @module @qverisai/mcp
 * @version Read from package.json at runtime
 *
 * @example
 * Configure in Claude Desktop or Cursor:
 * ```json
 * {
 *   "mcpServers": {
 *     "qveris": {
 *       "command": "npx",
 *       "args": ["-y", "@qverisai/mcp"],
 *       "env": { "QVERIS_API_KEY": "your-api-key" }
 *     }
 *   }
 * }
 * ```
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { resolveTransportConfig, startHttpServer } from './http.js';
import { buildServerCard, type ServerCardInfo } from './server-card.js';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

import { createClientFromEnv, QverisClient } from './api/client.js';
import { searchToolsSchema, executeSearchTools, type SearchToolsInput } from './tools/search.js';
import { executeToolSchema, executeExecuteTool, type ExecuteToolInput } from './tools/execute.js';
import { getToolsByIdsSchema, executeGetToolsByIds, type GetToolsByIdsInput } from './tools/get-by-ids.js';
import { usageHistorySchema, executeUsageHistory, type UsageHistoryInput } from './tools/usage-history.js';
import { creditsLedgerSchema, executeCreditsLedger, type CreditsLedgerInput } from './tools/credits-ledger.js';
import type { ApiError } from './types.js';
import { TOOL_OUTPUT_SCHEMAS } from './output-schemas.js';

// ============================================================================
// Server Configuration
// ============================================================================

import { createRequire } from 'node:module';

const SERVER_NAME = 'qveris';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
export const SERVER_VERSION: string = pkg.version;

/** Discovery metadata (Server Card + Catalog) derived from package.json. */
export function getQverisServerCardInfo(): ServerCardInfo {
  const repoUrl: string | undefined = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
  return {
    name: pkg.mcpName ?? 'io.github.QVerisAI/mcp',
    version: SERVER_VERSION,
    description: pkg.description,
    title: 'QVeris',
    websiteUrl: pkg.homepage,
    repository: repoUrl ? { source: 'github', url: repoUrl, subfolder: pkg.repository?.directory } : undefined,
    protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  };
}

/**
 * List the MCP tools exposed by this server.
 *
 * Kept as a pure export so the public MCP interface can be tested without
 * starting stdio transport.
 */
export function listQverisMcpTools() {
  return [
    // Primary tools (aligned with CLI naming)
    {
      name: 'discover',
      description:
        'Discover available tools based on natural language queries. ' +
        'Returns relevant tools that can help accomplish tasks. ' +
        'Use this to find tools before inspecting or calling them. ' +
        'Results may include billing_rule metadata for rule-level pricing.',
      inputSchema: searchToolsSchema,
      outputSchema: TOOL_OUTPUT_SCHEMAS.discover,
    },
    {
      name: 'inspect',
      description:
        'Inspect tools by their IDs to get detailed information. ' +
        'Returns parameters, success rate, latency, examples, and billing_rule when available. ' +
        'Use tool_ids from a previous discover call.',
      inputSchema: getToolsByIdsSchema,
      outputSchema: TOOL_OUTPUT_SCHEMAS.inspect,
    },
    {
      name: 'call',
      description:
        'Call a specific remote tool with provided parameters. ' +
        'The tool_id and search_id must come from a previous discover call. ' +
        'Pass parameters to the tool through params_to_tool. ' +
        'The response may include pre-settlement billing; use usage_history or credits_ledger for final charge status.',
      inputSchema: executeToolSchema,
      outputSchema: TOOL_OUTPUT_SCHEMAS.call,
    },
    {
      name: 'usage_history',
      description:
        'Context-safe usage audit query. Defaults to aggregated summary, supports precise search by execution_id/search_id/charge_outcome/credit range, and writes large exports to a local JSONL file instead of returning all rows.',
      inputSchema: usageHistorySchema,
      outputSchema: TOOL_OUTPUT_SCHEMAS.usage_history,
    },
    {
      name: 'credits_ledger',
      description:
        'Context-safe final credits ledger query. Defaults to aggregated summary, supports precise search by entry type/direction/credit range, and writes large exports to a local JSONL file instead of returning all rows.',
      inputSchema: creditsLedgerSchema,
      outputSchema: TOOL_OUTPUT_SCHEMAS.credits_ledger,
    },
    // Deprecated aliases (backward compatibility)
    {
      name: 'search_tools',
      description: '[Deprecated: use "discover" instead] Search for available tools based on natural language queries.',
      inputSchema: searchToolsSchema,
    },
    {
      name: 'get_tools_by_ids',
      description: '[Deprecated: use "inspect" instead] Get descriptions of tools based on their tool IDs.',
      inputSchema: getToolsByIdsSchema,
    },
    {
      name: 'execute_tool',
      description: '[Deprecated: use "call" instead] Execute a specific remote tool with provided parameters.',
      inputSchema: executeToolSchema,
    },
  ];
}

// Deprecated tool name aliases -> canonical names.
export const DEPRECATED_ALIASES: Record<string, string> = {
  search_tools: 'discover',
  get_tools_by_ids: 'inspect',
  execute_tool: 'call',
};

function buildMcpObservability(
  requestedTool: string,
  mcpTool: string,
  args: unknown,
  defaultSessionId: string,
): Record<string, unknown> {
  const input = isRecord(args) ? args : {};
  const toolId = readString(input.tool_id);

  return compactObject({
    source: 'qveris_mcp',
    requested_tool: requestedTool,
    mcp_tool: mcpTool,
    session_id: readString(input.session_id) ?? defaultSessionId,
    search_id: readString(input.search_id),
    tool_id: toolId,
    provider_id: inferProviderId(toolId),
    query: readString(input.query),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function inferProviderId(toolId: string | undefined): string | undefined {
  if (!toolId) return undefined;
  const [providerId] = toolId.split('.');
  return providerId || undefined;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

/**
 * Route one MCP tool call to the matching Qveris operation.
 */
/** Asks the human to approve a charged call; resolve false to cancel it. */
export type ConfirmCall = (info: { toolId: string }) => Promise<boolean>;

export async function executeQverisMcpTool(
  client: QverisClient | undefined,
  defaultSessionId: string,
  rawName: string,
  args: unknown,
  warn: (message: string) => void = (message) => process.stderr.write(message),
  confirmCall?: ConfirmCall,
): Promise<CallToolResult> {
  // Tool listing works without credentials, but calls need a key. When the
  // server started without QVERIS_API_KEY the client is undefined; return an
  // actionable error instead of crashing.
  if (!client) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error:
              'QVERIS_API_KEY is not set. Tool listing works without a key, but tool calls require one. ' +
              'Create a key at https://qveris.ai/account?page=api-keys, set QVERIS_API_KEY, and restart the server.',
          }),
        },
      ],
      isError: true,
    };
  }

  // Resolve deprecated aliases.
  let name = rawName;
  if (DEPRECATED_ALIASES[rawName]) {
    name = DEPRECATED_ALIASES[rawName];
    warn(`[qveris] Deprecated: "${rawName}" -> use "${name}" instead\n`);
  }
  const mcpObservability = buildMcpObservability(rawName, name, args, defaultSessionId);

  try {
    if (name === 'discover') {
      const input = (args ?? {}) as unknown as SearchToolsInput;

      // Validate required fields.
      if (!input.query || typeof input.query !== 'string') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Missing required parameter: query',
                hint: 'Provide a natural language query describing the tool capability you need',
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await executeSearchTools(client, input, defaultSessionId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (name === 'inspect') {
      const input = (args ?? {}) as unknown as GetToolsByIdsInput;

      // Validate required fields.
      if (!input.tool_ids || !Array.isArray(input.tool_ids) || input.tool_ids.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Missing or invalid required parameter: tool_ids',
                hint: 'Provide an array of tool IDs (at least one) to retrieve tool information',
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await executeGetToolsByIds(client, input, defaultSessionId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (name === 'call') {
      const input = (args ?? {}) as unknown as ExecuteToolInput;

      // Validate required fields.
      const missingFields: string[] = [];
      if (!input.tool_id) missingFields.push('tool_id');
      if (!input.search_id) missingFields.push('search_id');
      if (input.params_to_tool === undefined) missingFields.push('params_to_tool');

      if (missingFields.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Missing required parameters: ${missingFields.join(', ')}`,
                hint: 'tool_id and search_id must come from a previous discover call',
              }),
            },
          ],
          isError: true,
        };
      }

      // Human-in-the-loop billing consent (MCP elicitation), when enabled and
      // the client supports it. Declining cancels the charged call.
      if (confirmCall && !(await confirmCall({ toolId: input.tool_id }))) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Call cancelled: the user declined the billing confirmation.',
                tool_id: input.tool_id,
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await executeExecuteTool(client, input, defaultSessionId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (name === 'usage_history') {
      const input = (args ?? {}) as unknown as UsageHistoryInput;
      const result = await executeUsageHistory(client, input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (name === 'credits_ledger') {
      const input = (args ?? {}) as unknown as CreditsLedgerInput;
      const result = await executeCreditsLedger(client, input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    // Unknown tool.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Unknown tool: ${rawName}`,
            available_tools: ['discover', 'inspect', 'call', 'usage_history', 'credits_ledger'],
          }),
        },
      ],
      isError: true,
    };
  } catch (error) {
    // Handle API errors.
    if (isApiError(error)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              status: error.status,
              ...(error.details !== undefined && { details: error.details }),
              ...(error.cause && { cause: error.cause }),
              observability: compactObject({
                ...mcpObservability,
                api: error.observability,
              }),
            }),
          },
        ],
        isError: true,
      };
    }

    // Handle other errors (including fetch network errors).
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorCause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: errorMessage,
            ...(errorCause && { cause: errorCause }),
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Build a fully-wired Qveris MCP {@link Server} instance.
 *
 * Registers the list-tools and call-tool handlers against the given client and
 * default session id. Kept separate from transport startup so both the stdio
 * and Streamable HTTP paths (and tests) can construct a server the same way; in
 * HTTP mode one server is created per client session.
 */
const CARD_RESOURCE_URI = 'qveris://server-card';
const CAPABILITY_URI_PREFIX = 'qveris://capability/';

function confirmCallsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.QVERIS_MCP_CONFIRM_CALLS?.trim().toLowerCase();
  return v !== undefined && ['1', 'true', 'yes', 'on'].includes(v);
}

export function createQverisServer(client: QverisClient | undefined, defaultSessionId: string): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Lists available tools (discover/inspect/call plus deprecated aliases).
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: listQverisMcpTools(),
    };
  });

  // Human-in-the-loop billing consent for charged calls: only when explicitly
  // enabled (headless agents stay unaffected) AND the client supports
  // elicitation. Declining or cancelling the form cancels the call.
  const confirmCall: ConfirmCall | undefined = confirmCallsEnabled()
    ? async ({ toolId }) => {
        if (!server.getClientCapabilities()?.elicitation) return true;
        const answer = await server.elicitInput({
          message: `QVeris is about to call "${toolId}". This may consume credits (pre-settlement billing is returned with the result). Proceed?`,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: { type: 'boolean', title: 'Proceed with this charged call?' },
            },
            required: ['confirm'],
          },
        });
        return answer.action === 'accept' && answer.content?.confirm === true;
      }
    : undefined;

  // Routes tool execution to the appropriate handler; deprecated aliases warn.
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    return executeQverisMcpTool(client, defaultSessionId, name, args, undefined, confirmCall);
  });

  // --- Resources: the Server Card plus per-capability metadata docs ---------

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: CARD_RESOURCE_URI,
        name: 'QVeris Server Card',
        description: 'Identity and connection metadata for this MCP server (SEP-2127).',
        mimeType: 'application/mcp-server-card+json',
      },
    ],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: `${CAPABILITY_URI_PREFIX}{tool_id}`,
        name: 'QVeris capability metadata',
        description:
          'Full metadata for one capability (parameters, examples, stats, billing) — the same payload the inspect tool returns.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === CARD_RESOURCE_URI) {
      const card = buildServerCard(getQverisServerCardInfo());
      return {
        contents: [{ uri, mimeType: 'application/mcp-server-card+json', text: JSON.stringify(card) }],
      };
    }
    if (uri.startsWith(CAPABILITY_URI_PREFIX)) {
      const toolId = decodeURIComponent(uri.slice(CAPABILITY_URI_PREFIX.length));
      if (!toolId) throw new Error('Missing tool_id in capability URI');
      if (!client) {
        throw new Error('QVERIS_API_KEY is not set; capability metadata requires an API key.');
      }
      const detail = await client.getToolsByIds({ tool_ids: [toolId] });
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(detail) }],
      };
    }
    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

/**
 * Main entry point for the Qveris MCP Server.
 *
 * Registers the discover/inspect/call handlers and starts listening. The
 * transport is selected by env/CLI (see {@link resolveTransportConfig}): stdio
 * by default (unchanged for existing Claude Desktop / Cursor configs), or
 * Streamable HTTP for remote deployment.
 */
export async function main(): Promise<void> {
  const client = initializeQverisClient();

  const transportConfig = resolveTransportConfig(process.env, process.argv.slice(2));

  // Streamable HTTP: one Qveris server per MCP session, keyed by Mcp-Session-Id.
  if (transportConfig.mode === 'http') {
    await startHttpServer(
      transportConfig,
      (sessionId) => createQverisServer(client, sessionId),
      getQverisServerCardInfo(),
    );
    return;
  }

  // Default: stdio transport with a single session for this process.
  const defaultSessionId = uuidv4();
  const server = createQverisServer(client, defaultSessionId);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup to stderr (stdout is reserved for MCP protocol)
  console.error(`Qveris MCP Server v${SERVER_VERSION} started (stdio)`);
  console.error(`Session ID: ${defaultSessionId}`);
}

/**
 * Initialize the API client without hiding invalid endpoint configuration.
 * A missing key is intentionally non-fatal so registry scanners can list tools;
 * any other configuration error must fail startup.
 */
export function initializeQverisClient(): QverisClient | undefined {
  if (!process.env.QVERIS_API_KEY) {
    console.error(
      'QVERIS_API_KEY environment variable is required.\n' + 'Create one at https://qveris.ai/account?page=api-keys',
    );
    console.error('Starting without credentials: tool listing is available; set QVERIS_API_KEY to enable tool calls.');
    return undefined;
  }

  return createClientFromEnv();
}

// Public embedding surface for independently operated HTTP services. The
// toolkit owns protocol/session mechanics; embedders own credential policy,
// client construction, deployment, and operations.
export { QverisClient, resolveTransportConfig, startHttpServer };
export { SessionAuthenticationError, SessionAuthenticationUnavailableError, SessionRateLimitError } from './http.js';
export type { HttpSessionAuth, RunningHttpServer, TransportConfig } from './http.js';
export type { ServerCardInfo } from './server-card.js';

/**
 * Type guard for API errors.
 */
function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'status' in error && 'message' in error;
}

export function isEntrypoint(argvEntry: string | undefined, moduleUrl = import.meta.url): boolean {
  if (!argvEntry) return false;

  try {
    return pathToFileURL(realpathSync(argvEntry)).href === moduleUrl;
  } catch {
    try {
      return pathToFileURL(argvEntry).href === moduleUrl;
    } catch {
      return false;
    }
  }
}

// Run the server only when this file is the process entrypoint.
if (isEntrypoint(process.argv[1])) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
