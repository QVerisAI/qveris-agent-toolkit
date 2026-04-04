/**
 * execute_tool MCP Tool Implementation
 *
 * Executes a specific remote tool with provided parameters.
 * The tool_id must come from a previous search_tools call.
 *
 * @module tools/execute
 */

import type { QverisClient } from '../api/client.js';
import type { ExecuteResponse } from '../types.js';

/**
 * Input parameters for the execute_tool tool.
 */
export interface ExecuteToolInput {
  /**
   * The ID of the remote tool to execute.
   * Must be obtained from search_tools results.
   */
  tool_id: string;

  /**
   * The search_id from the search_tools response that returned this tool.
   * Links the execution to the original search for analytics and billing.
   */
  search_id: string;

  /**
   * JSON stringified dictionary of parameters to pass to the remote tool.
   * Keys are parameter names, values can be of any type.
   *
   * @example '{"city": "London", "units": "metric"}'
   * @example '{"query": "AI news", "limit": 10}'
   */
  params_to_tool: string;

  /**
   * Session identifier for tracking user sessions.
   * If not provided, the server will use an auto-generated session ID.
   */
  session_id?: string;

  /**
   * Maximum size of response data in bytes.
   * If the tool generates data longer than this limit, the response
   * will be truncated and a download URL provided for the full content.
   *
   * @default 20480 (20KB)
   * @minimum -1 (-1 means no limit)
   */
  max_response_size?: number;
}

/**
 * JSON Schema for the execute_tool tool input.
 * Used by MCP to validate and document the tool parameters.
 */
export const executeToolSchema = {
  type: 'object' as const,
  properties: {
    tool_id: {
      type: 'string',
      description:
        'The ID of the remote tool to execute. Must come from a previous search_tools call.',
    },
    search_id: {
      type: 'string',
      description:
        'The search_id from the search_tools response that returned this tool. ' +
        'Required for linking execution to the original search.',
    },
    params_to_tool: {
      type: 'string',
      description:
        'A JSON stringified dictionary of parameters to pass to the remote tool. ' +
        'Keys are param names and values can be of any type. ' +
        'Example: \'{"city": "London", "units": "metric"}\'',
    },
    session_id: {
      type: 'string',
      description:
        'Session identifier for tracking user sessions. ' +
        'If not provided, an auto-generated session ID will be used.',
    },
    max_response_size: {
      type: 'number',
      description:
        'Maximum size of response data in bytes. ' +
        'If tool generates data longer than this, it will be truncated and a download URL provided. ' +
        'Use -1 for no limit. Default is 20480 (20KB).',
      default: 20480,
    },
  },
  required: ['tool_id', 'params_to_tool'],
};

/**
 * Executes the execute_tool operation.
 *
 * @param client - Initialized Qveris API client
 * @param input - Execution parameters
 * @param defaultSessionId - Fallback session ID if not provided in input
 * @returns Execution result from the tool
 * @throws {Error} If params_to_tool is not valid JSON
 */
export async function executeExecuteTool(
  client: QverisClient,
  input: ExecuteToolInput,
  defaultSessionId: string
): Promise<ExecuteResponse> {
  // Parse the JSON parameters
  let parameters: Record<string, unknown>;
  try {
    parameters = JSON.parse(input.params_to_tool) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid JSON in params_to_tool: ${error instanceof Error ? error.message : 'Unknown parse error'}. ` +
      `Received: ${input.params_to_tool}`
    );
  }

  const response = await client.executeTool(input.tool_id, {
    search_id: input.search_id,
    session_id: input.session_id ?? defaultSessionId,
    parameters,
    max_response_size: input.max_response_size,
  });

  return response;
}

