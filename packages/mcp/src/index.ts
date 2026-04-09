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
 *       "args": ["@qverisai/mcp"],
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
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';

import { createClientFromEnv, QverisClient } from './api/client.js';
import {
  searchToolsSchema,
  executeSearchTools,
  type SearchToolsInput,
} from './tools/search.js';
import {
  executeToolSchema,
  executeExecuteTool,
  type ExecuteToolInput,
} from './tools/execute.js';
import {
  getToolsByIdsSchema,
  executeGetToolsByIds,
  type GetToolsByIdsInput,
} from './tools/get-by-ids.js';
import type { ApiError } from './types.js';

// ============================================================================
// Server Configuration
// ============================================================================

import { createRequire } from 'node:module';

const SERVER_NAME = 'qveris';
const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require('../package.json');

/**
 * Main entry point for the Qveris MCP Server.
 *
 * Sets up the MCP server with stdio transport, registers the discover,
 * inspect, and call handlers, and starts listening for requests.
 */
async function main(): Promise<void> {
  // Initialize API client (validates QVERIS_API_KEY)
  let client: QverisClient;
  try {
    client = createClientFromEnv();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Failed to initialize Qveris client'
    );
    process.exit(1);
  }

  // Generate a default session ID for this server instance
  const defaultSessionId = uuidv4();

  // Create MCP server
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // =========================================================================
  // Tool Handlers
  // =========================================================================

  /**
   * Lists available tools.
   * Returns the discover, inspect, and call definitions (plus deprecated aliases).
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Primary tools (aligned with CLI naming)
        {
          name: 'discover',
          description:
            'Discover available tools based on natural language queries. ' +
            'Returns relevant tools that can help accomplish tasks. ' +
            'Use this to find tools before inspecting or calling them.',
          inputSchema: searchToolsSchema,
        },
        {
          name: 'inspect',
          description:
            'Inspect tools by their IDs to get detailed information. ' +
            'Returns parameters, success rate, latency, and examples. ' +
            'Use tool_ids from a previous discover call.',
          inputSchema: getToolsByIdsSchema,
        },
        {
          name: 'call',
          description:
            'Call a specific remote tool with provided parameters. ' +
            'The tool_id and search_id must come from a previous discover call. ' +
            'Pass parameters to the tool through params_to_tool.',
          inputSchema: executeToolSchema,
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
      ],
    };
  });

  // Deprecated tool name aliases → canonical names
  const DEPRECATED_ALIASES: Record<string, string> = {
    search_tools: 'discover',
    get_tools_by_ids: 'inspect',
    execute_tool: 'call',
  };

  /**
   * Handles tool execution requests.
   * Routes to the appropriate handler based on tool name.
   * Deprecated aliases emit a warning to stderr.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name: rawName, arguments: args } = request.params;

    // Resolve deprecated aliases
    let name = rawName;
    if (DEPRECATED_ALIASES[rawName]) {
      name = DEPRECATED_ALIASES[rawName];
      process.stderr.write(`[qveris] Deprecated: "${rawName}" → use "${name}" instead\n`);
    }

    try {
      if (name === 'discover') {
        const input = (args ?? {}) as unknown as SearchToolsInput;

        // Validate required fields
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'inspect') {
        const input = (args ?? {}) as unknown as GetToolsByIdsInput;

        // Validate required fields
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'call') {
        const input = (args ?? {}) as unknown as ExecuteToolInput;

        // Validate required fields
        const missingFields: string[] = [];
        if (!input.tool_id) missingFields.push('tool_id');
        if (!input.search_id) missingFields.push('search_id');
        if (!input.params_to_tool) missingFields.push('params_to_tool');

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

        const result = await executeExecuteTool(client, input, defaultSessionId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Unknown tool
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Unknown tool: ${rawName}`,
              available_tools: ['discover', 'inspect', 'call'],
            }),
          },
        ],
        isError: true,
      };
    } catch (error) {
      // Handle API errors
      if (isApiError(error)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error.message,
                status: error.status,
                details: error.details,
              }),
            },
          ],
          isError: true,
        };
      }

      // Handle other errors (including fetch network errors)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorCause = error instanceof Error && error.cause instanceof Error 
        ? error.cause.message 
        : undefined;

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
  });

  // =========================================================================
  // Start Server
  // =========================================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup to stderr (stdout is reserved for MCP protocol)
  console.error(`Qveris MCP Server v${SERVER_VERSION} started`);
  console.error(`Session ID: ${defaultSessionId}`);
}

/**
 * Type guard for API errors.
 */
function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  );
}

// Run the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

