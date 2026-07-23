/**
 * call MCP Tool Implementation (formerly execute_tool)
 *
 * Executes a specific remote tool with provided parameters.
 * The tool_id must come from a previous discover call.
 *
 * @module tools/execute
 */

import type { QverisClient } from '../api/client.js';
import type { ExecuteResponse } from '../types.js';

/**
 * Input parameters for the call tool.
 */
export interface ExecuteToolInput {
  /**
   * The ID of the remote tool to execute.
   * Must be obtained from discover results.
   */
  tool_id: string;

  /**
   * The search_id from the discover response that returned this tool.
   * Links the execution to the original search for analytics and billing.
   */
  search_id: string;

  /**
   * Dictionary of parameters to pass to the remote tool.
   * Keys are parameter names, values can be of any type.
   *
   * @example {"city": "London", "units": "metric"}
   * @example {"query": "AI news", "limit": 10}
   */
  params_to_tool: Record<string, unknown>;

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

  /** Server-side result projection. Omit for the legacy/full response. */
  respond_with?: 'full' | 'summary' | `fields:${string}`;
}

/**
 * JSON Schema for the call tool input.
 * Used by MCP to validate and document the tool parameters.
 */
export const executeToolSchema = {
  type: 'object' as const,
  properties: {
    tool_id: {
      type: 'string',
      description: 'The ID of the remote tool to execute. Must come from a previous discover call.',
    },
    search_id: {
      type: 'string',
      description:
        'The search_id from the discover response that returned this tool. ' +
        'Required for linking execution to the original discovery.',
    },
    params_to_tool: {
      type: 'object',
      description:
        'A dictionary of parameters to pass to the remote tool. ' +
        'Keys are param names and values can be of any type. ' +
        'Example: {"city": "London", "units": "metric"}',
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
    respond_with: {
      type: 'string',
      pattern: '^(full|summary|fields:.+)$',
      description: 'Server-side result projection: "full", "summary", or "fields:<JSONPath,...>". Omit for full.',
    },
  },
  required: ['tool_id', 'search_id', 'params_to_tool'],
};

/**
 * Executes the call operation.
 *
 * @param client - Initialized Qveris API client
 * @param input - Execution parameters
 * @param defaultSessionId - Fallback session ID if not provided in input
 * @returns Execution result from the tool
 * @throws {Error} If params_to_tool is not a JSON object
 */
export async function executeExecuteTool(
  client: QverisClient,
  input: ExecuteToolInput,
  defaultSessionId: string,
): Promise<ExecuteResponse> {
  if (!isParamsObject(input.params_to_tool)) {
    throw new Error('params_to_tool must be a JSON object.');
  }

  const response = await client.executeTool(input.tool_id, {
    search_id: input.search_id,
    session_id: input.session_id ?? defaultSessionId,
    parameters: input.params_to_tool,
    max_response_size: input.max_response_size,
    ...(input.respond_with !== undefined && { respond_with: input.respond_with }),
  });

  return response;
}

function isParamsObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
