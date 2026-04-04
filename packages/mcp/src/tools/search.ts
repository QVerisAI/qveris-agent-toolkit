/**
 * search_tools MCP Tool Implementation
 *
 * Searches for available tools based on natural language queries.
 * Returns relevant tools that can help accomplish tasks.
 *
 * @module tools/search
 */

import type { QverisClient } from '../api/client.js';
import type { SearchResponse } from '../types.js';

/**
 * Input parameters for the search_tools tool.
 */
export interface SearchToolsInput {
  /**
   * The search query describing the general capability of the tool.
   * Should describe what you want to accomplish, not specific parameters.
   *
   * @example "weather forecast API"
   * @example "send email notification"
   * @example "stock price lookup"
   */
  query: string;

  /**
   * Maximum number of results to return.
   * @default 20
   * @minimum 1
   * @maximum 100
   */
  limit?: number;

  /**
   * Session identifier for tracking user sessions.
   * If not provided, the server will use an auto-generated session ID.
   */
  session_id?: string;
}

/**
 * JSON Schema for the search_tools tool input.
 * Used by MCP to validate and document the tool parameters.
 */
export const searchToolsSchema = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description:
        'The search query describing the general capability of the tool. ' +
        'Describe what you want to accomplish, not specific params you want to pass to the tool later. ' +
        'Example: "weather forecast API", "send email", "stock prices"',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (1-100)',
      default: 20,
      minimum: 1,
      maximum: 100,
    },
    session_id: {
      type: 'string',
      description:
        'Session identifier for tracking user sessions. ' +
        'If not provided, an auto-generated session ID will be used.',
    },
  },
  required: ['query'],
};

/**
 * Executes the search_tools operation.
 *
 * @param client - Initialized Qveris API client
 * @param input - Search parameters
 * @param defaultSessionId - Fallback session ID if not provided in input
 * @returns Search results with matching tools
 */
export async function executeSearchTools(
  client: QverisClient,
  input: SearchToolsInput,
  defaultSessionId: string
): Promise<SearchResponse> {
  const response = await client.searchTools({
    query: input.query,
    limit: input.limit ?? 20,
    session_id: input.session_id ?? defaultSessionId,
  });

  return response;
}

