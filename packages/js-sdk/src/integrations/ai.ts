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

import { z } from 'zod';

import type { Qveris } from '../client.js';

/** Stable structural tool shape shared by the supported AI SDK versions. */
export interface QverisAdapterTool<Input, Output> {
  description: string;
  inputSchema: z.ZodType<Input>;
  execute: (input: Input) => Promise<Output>;
}

function adapterTool<Input, Output>(definition: QverisAdapterTool<Input, Output>): QverisAdapterTool<Input, Output> {
  // AI tools are structural objects. Keep emitted declarations independent of
  // version-specific optional properties added by the framework helper.
  return definition;
}

export interface QverisAdapterOptions {
  sessionId?: string;
  model?: string;
  subUserId?: string;
  includeProbe?: boolean;
}

export type QverisDefaultTools = {
  qveris_discover: QverisAdapterTool<{ query: string; limit?: number }, Awaited<ReturnType<Qveris['discover']>>>;
  qveris_inspect: QverisAdapterTool<{ tool_ids: string[]; search_id?: string }, Awaited<ReturnType<Qveris['inspect']>>>;
  qveris_call: QverisAdapterTool<
    { tool_id: string; params_to_tool?: Record<string, unknown>; search_id?: string; max_response_size?: number },
    Awaited<ReturnType<Qveris['call']>>
  >;
};
export type QverisProbeTools = QverisDefaultTools & {
  qveris_probe: QverisAdapterTool<
    {
      tool_id: string;
      parameters?: Record<string, unknown>;
      checks?: Array<'schema' | 'quote' | 'coverage' | 'sample'>;
      live_budget?: 'none' | 'metadata' | 'sampled';
    },
    Awaited<ReturnType<Qveris['probe']>>
  >;
};

export function getQverisTools(
  qveris: Qveris,
  options: QverisAdapterOptions & { includeProbe: true },
): QverisProbeTools;
export function getQverisTools(qveris: Qveris, options?: QverisAdapterOptions): QverisDefaultTools;

/**
 * Build Vercel AI SDK tools for the shortest-safe QVeris workflow.
 *
 * @param qveris - The Qveris client to route calls through.
 * @param options - Host-controlled OAuth identity plus optional session and model metadata.
 * @returns A tools object keyed by `qveris_discover` / `qveris_inspect` /
 *   `qveris_call`, ready to pass to `generateText`/`streamText`.
 */
export function getQverisTools(qveris: Qveris, options: QverisAdapterOptions = {}) {
  if (
    !qveris ||
    typeof qveris.discover !== 'function' ||
    typeof qveris.inspect !== 'function' ||
    typeof qveris.call !== 'function'
  ) {
    throw new TypeError('getQverisTools requires a valid Qveris client instance.');
  }
  const { sessionId, model, subUserId } = options;
  if (subUserId !== undefined && (typeof subUserId !== 'string' || !subUserId.trim())) {
    throw new TypeError('subUserId must be a non-empty host-controlled identity.');
  }

  const tools = {
    qveris_discover: adapterTool({
      description:
        'Discover QVeris capabilities when task fit, data quality/freshness, provider comparison, fallback, or the user request favors QVeris. It is not a mandatory gateway. Free; returns candidates and a search_id. Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision requires a current Probe cost quote, do not Call until the host obtains it; this three-tool adapter does not expose Probe. This does not apply to fresh business data such as a stock quote; obtain that with Call.',
      inputSchema: z.object({
        query: z.string().describe("Capability query, e.g. 'weather forecast API'."),
        limit: z.number().int().min(1).max(100).optional().describe('Number of results (1-100).'),
      }),
      execute: async ({ query, limit }) =>
        qveris.discover(query, { ...(limit !== undefined && { limit }), ...(sessionId && { sessionId }) }),
    }),

    qveris_inspect: adapterTool({
      description:
        'Optional: inspect capabilities only when selection or valid request construction depends on missing/stale contract details. Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision requires a current Probe cost quote, do not Call until the host obtains it; this three-tool adapter does not expose Probe. This does not apply to fresh business data such as a stock quote; obtain that with Call. Free.',
      inputSchema: z.object({
        tool_ids: z.array(z.string()).describe('Tool IDs returned by discover.'),
        search_id: z.string().optional().describe('The search_id from the discover response, if available.'),
      }),
      execute: async ({ tool_ids, search_id }) =>
        qveris.inspect(tool_ids, { ...(search_id && { searchId: search_id }), ...(sessionId && { sessionId }) }),
    }),

    qveris_call: adapterTool({
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
          ...(subUserId !== undefined && { subUserId }),
        }),
    }),
  };
  if (options.includeProbe) {
    if (typeof qveris.probe !== 'function') throw new TypeError('Probe requires a client with probe().');
    for (const item of [tools.qveris_discover, tools.qveris_inspect]) {
      if (typeof item.description === 'string')
        item.description = item.description.replace(
          'do not Call until the host obtains it; this three-tool adapter does not expose Probe.',
          'use qveris_probe to obtain it before Call.',
        );
    }
    return {
      ...tools,
      qveris_probe: adapterTool({
        description:
          'Optionally validate parameters or obtain a current schema/quote without executing a capability. Free. A quote does not reserve price or authorize execution; coverage/sample may be unknown.',
        inputSchema: z.object({
          tool_id: z.string().min(1),
          parameters: z.record(z.string(), z.unknown()).optional(),
          checks: z
            .array(z.enum(['schema', 'quote', 'coverage', 'sample']))
            .min(1)
            .optional(),
          live_budget: z.enum(['none', 'metadata', 'sampled']).optional(),
        }),
        execute: async ({ tool_id, parameters, checks, live_budget }) =>
          qveris.probe(tool_id, {
            ...(parameters !== undefined && { parameters }),
            ...(checks !== undefined && { checks }),
            ...(live_budget !== undefined && { liveBudget: live_budget }),
            ...(subUserId !== undefined && { subUserId }),
          }),
      }),
    };
  }
  return tools;
}
