/**
 * get_tools_by_ids MCP Tool Implementation
 *
 * Retrieves tool descriptions based on tool IDs.
 * Useful for getting detailed information about specific tools
 * when you already know their tool_ids.
 *
 * @module tools/get-by-ids
 */

import type { QverisClient } from '../api/client.js';
import type { SearchResponse } from '../types.js';

/**
 * Input parameters for the get_tools_by_ids tool.
 */
export interface GetToolsByIdsInput {
  /**
   * Array of tool IDs to retrieve information for.
   * Must be obtained from previous search_tools results.
   *
   * @example ["weather-tool-1", "email-tool-2"]
   */
  tool_ids: string[];

  /**
   * The search_id from the search_tools response that returned the tool(s).
   * Optional but recommended for analytics and billing.
   */
  search_id?: string;

  /**
   * Session identifier for tracking user sessions.
   * If not provided, the server will use an auto-generated session ID.
   */
  session_id?: string;
}

/**
 * JSON Schema for the get_tools_by_ids tool input.
 * Used by MCP to validate and document the tool parameters.
 */
export const getToolsByIdsSchema = {
  type: 'object' as const,
  properties: {
    tool_ids: {
      type: 'array',
      items: {
        type: 'string',
      },
      description:
        'Array of tool IDs to retrieve information for. ' +
        'These IDs should come from previous search_tools results.',
      minItems: 1,
    },
    search_id: {
      type: 'string',
      description:
        'The search_id from the search_tools response that returned the tool(s). ' +
        'Optional but recommended for linking to the original search.',
    },
    session_id: {
      type: 'string',
      description:
        'Session identifier for tracking user sessions. ' +
        'If not provided, an auto-generated session ID will be used.',
    },
  },
  required: ['tool_ids'],
};

/**
 * Executes the get_tools_by_ids operation.
 *
 * @param client - Initialized Qveris API client
 * @param input - Request parameters with tool IDs
 * @param defaultSessionId - Fallback session ID if not provided in input
 * @returns Tool information for the requested IDs
 */
export async function executeGetToolsByIds(
  client: QverisClient,
  input: GetToolsByIdsInput,
  defaultSessionId: string
): Promise<SearchResponse> {
  const response = await client.getToolsByIds({
    tool_ids: input.tool_ids,
    search_id: input.search_id,
    session_id: input.session_id ?? defaultSessionId,
  });

  return response;
}

