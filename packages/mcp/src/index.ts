#!/usr/bin/env node
/**
 * Qveris MCP Server
 *
 * A Model Context Protocol (MCP) server that provides access to the Qveris
 * tool discovery and execution API. Enables LLMs to dynamically search for
 * and execute third-party tools via natural language.
 *
 * @module @qverisai/mcp
 * @version 0.1.0
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

const SERVER_NAME = 'qveris';
const SERVER_VERSION = '0.1.0';

/**
 * Main entry point for the Qveris MCP Server.
 *
 * Sets up the MCP server with stdio transport, registers the search_tools
 * and execute_tool handlers, and starts listening for requests.
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
   * Returns the search_tools, get_tools_by_ids, and execute_tool definitions.
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_tools',
          description:
            'Search for available tools based on natural language queries. ' +
            'Returns relevant tools that can help accomplish tasks. ' +
            'Use this to discover tools before executing them.',
          inputSchema: searchToolsSchema,
        },
        {
          name: 'get_tools_by_ids',
          description:
            'Get descriptions of tools based on their tool IDs. ' +
            'Useful for retrieving detailed information about specific tools ' +
            'when you already know their tool_ids from previous searches.',
          inputSchema: getToolsByIdsSchema,
        },
        {
          name: 'execute_tool',
          description:
            'Execute a specific remote tool with provided parameters. ' +
            'The tool_id and search_id must come from a previous search_tools call. ' +
            'Pass parameters to the tool through params_to_tool as a JSON string.',
          inputSchema: executeToolSchema,
        },
      ],
    };
  });

  /**
   * Handles tool execution requests.
   * Routes to the appropriate handler based on tool name.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'search_tools') {
        const input = args as unknown as SearchToolsInput;

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

      if (name === 'get_tools_by_ids') {
        const input = args as unknown as GetToolsByIdsInput;

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

      if (name === 'execute_tool') {
        const input = args as unknown as ExecuteToolInput;

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
                  hint: 'tool_id and search_id must come from a previous search_tools call',
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
              error: `Unknown tool: ${name}`,
              available_tools: ['search_tools', 'get_tools_by_ids', 'execute_tool'],
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

