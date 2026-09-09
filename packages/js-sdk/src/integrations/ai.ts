/**
 * Vercel AI SDK adapter for QVeris.
 *
 * Exposes QVeris discovery and calling as Vercel AI SDK tools, with inspection
 * available only when extra or refreshed detail is needed, so an agent can invoke
 * external capabilities through one QVeris API key.
 *
 * `ai` and `zod` are peer dependencies — install them alongside `@qverisai/sdk`.
 *
 * @example
 * ```typescript
 * import { generateText, stepCountIs } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { Qveris } from '@qverisai/sdk';
 * import { getQverisTools } from '@qverisai/sdk/ai';
 *
 * const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   tools: getQverisTools(qveris),
 *   stopWhen: stepCountIs(6),
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
 * Build Vercel AI SDK tools for the shortest-safe QVeris workflow.
 *
 * @param qveris - The Qveris client to route calls through.
 * @param options - Optional session and model metadata for correlation and quality analysis.
 * @returns A tools object keyed by `qveris_discover` / `qveris_inspect` /
 *   `qveris_call`, ready to pass to `generateText`/`streamText`.
 */
export function getQverisTools(qveris: Qveris, options: { sessionId?: string; model?: string } = {}) {
  if (
    !qveris ||
    typeof qveris.discover !== 'function' ||
    typeof qveris.inspect !== 'function' ||
    typeof qveris.call !== 'function'
  ) {
    throw new TypeError('getQverisTools requires a valid Qveris client instance.');
  }
  const { sessionId, model } = options;

  return {
    qveris_discover: tool({
      description:
        'Discover QVeris capabilities when task fit, data quality/freshness, provider comparison, fallback, or the user request favors QVeris. It is not a mandatory gateway. Free; returns candidates and a search_id. Provider comparison: Inspect each candidate to confirm current scope/contracts. If current quotes are required, do not Call until the host obtains them; this three-tool adapter does not expose Probe.',
      inputSchema: z.object({
        query: z.string().describe("Capability query, e.g. 'weather forecast API'."),
        limit: z.number().int().min(1).max(100).optional().describe('Number of results (1-100).'),
      }),
      execute: async ({ query, limit }) =>
        qveris.discover(query, { ...(limit !== undefined && { limit }), ...(sessionId && { sessionId }) }),
    }),

    qveris_inspect: tool({
      description:
        'Optional: inspect capabilities only when selection or valid request construction depends on missing/stale contract details. Provider comparison: Inspect each candidate to confirm current scope/contracts. If current quotes are required, do not Call until the host obtains them; this three-tool adapter does not expose Probe. Free.',
      inputSchema: z.object({
        tool_ids: z.array(z.string()).describe('Tool IDs returned by discover.'),
        search_id: z.string().optional().describe('The search_id from the discover response, if available.'),
      }),
      execute: async ({ tool_ids, search_id }) =>
        qveris.inspect(tool_ids, { ...(search_id && { searchId: search_id }), ...(sessionId && { sessionId }) }),
    }),

    qveris_call: tool({
      description:
        'Call a selected QVeris capability with parameters. Call directly from discovery when it provides enough schema and cost information. Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data. May consume credits.',
      inputSchema: z.object({
        tool_id: z.string().describe('The capability tool_id, from discover or inspect.'),
        params_to_tool: z.record(z.string(), z.unknown()).optional().describe('Parameters to pass to the capability.'),
        search_id: z.string().optional().describe('The search_id from the discover response, if available.'),
        max_response_size: z.number().int().optional().describe('Max response size in bytes; -1 means unlimited.'),
      }),
      execute: async ({ tool_id, search_id, params_to_tool = {}, max_response_size }) =>
        qveris.call(tool_id, {
          parameters: params_to_tool,
          ...(search_id && { searchId: search_id }),
          ...(max_response_size !== undefined && { maxResponseSize: max_response_size }),
          ...(sessionId && { sessionId }),
          ...(model && { model }),
        }),
    }),
  };
}
