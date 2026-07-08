/**
 * Vercel AI SDK adapter for QVeris.
 *
 * Exposes the QVeris discover / inspect / call workflow as Vercel AI SDK tools,
 * so an agent built with the `ai` package can find and invoke thousands of
 * external capabilities through one QVeris API key.
 *
 * `ai` and `zod` are peer dependencies — install them alongside `@qverisai/sdk`.
 *
 * @example
 * ```typescript
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { Qveris } from '@qverisai/sdk';
 * import { getQverisTools } from '@qverisai/sdk/ai';
 *
 * const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   tools: getQverisTools(qveris),
 *   maxSteps: 6,
 *   prompt: 'Find a stock quote capability and quote AAPL.',
 * });
 * ```
 *
 * @module @qverisai/sdk/ai
 */

import { tool } from 'ai';
import { z } from 'zod';

import type { Qveris } from '../client.js';

/**
 * Build Vercel AI SDK tools for the QVeris discover/inspect/call workflow.
 *
 * @param qveris - The Qveris client to route calls through.
 * @param options - Optional `sessionId` for correlation/pricing context.
 * @returns A tools object keyed by `qveris_discover` / `qveris_inspect` /
 *   `qveris_call`, ready to pass to `generateText`/`streamText`.
 */
export function getQverisTools(qveris: Qveris, options: { sessionId?: string } = {}) {
  const { sessionId } = options;

  return {
    qveris_discover: tool({
      description:
        'Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id.',
      inputSchema: z.object({
        query: z.string().describe("Capability query, e.g. 'weather forecast API'."),
        limit: z.number().int().min(1).max(100).optional().describe('Number of results (1-100).'),
      }),
      execute: async ({ query, limit }) =>
        qveris.discover(query, { ...(limit !== undefined && { limit }), ...(sessionId && { sessionId }) }),
    }),

    qveris_inspect: tool({
      description: 'Inspect one or more QVeris capabilities by tool_id before calling them. Free.',
      inputSchema: z.object({
        tool_ids: z.array(z.string()).describe('Tool IDs returned by discover.'),
        search_id: z.string().optional().describe('The search_id from the discover response, if available.'),
      }),
      execute: async ({ tool_ids, search_id }) =>
        qveris.inspect(tool_ids, { ...(search_id && { searchId: search_id }), ...(sessionId && { sessionId }) }),
    }),

    qveris_call: tool({
      description: 'Call a selected QVeris capability with parameters. May consume credits.',
      inputSchema: z.object({
        tool_id: z.string().describe('The capability tool_id, from discover or inspect.'),
        search_id: z.string().describe('The search_id from the discover response.'),
        params_to_tool: z.record(z.string(), z.unknown()).describe('Parameters to pass to the capability.'),
        max_response_size: z
          .number()
          .int()
          .optional()
          .describe('Max response size in bytes; -1 means unlimited.'),
      }),
      execute: async ({ tool_id, search_id, params_to_tool, max_response_size }) =>
        qveris.call(tool_id, {
          parameters: params_to_tool,
          searchId: search_id,
          ...(max_response_size !== undefined && { maxResponseSize: max_response_size }),
          ...(sessionId && { sessionId }),
        }),
    }),
  };
}
