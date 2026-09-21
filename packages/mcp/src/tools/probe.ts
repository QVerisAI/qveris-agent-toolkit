import type { QverisClient } from '../api/client.js';
import type { ProbeCheck, ProbeLiveBudget, ProbeResponse } from '../types.js';

export interface ProbeToolInput {
  sub_user_id?: string;
  tool_id: string;
  parameters?: Record<string, unknown>;
  checks?: ProbeCheck[];
  live_budget?: ProbeLiveBudget;
}

export const probeToolSchema = {
  type: 'object' as const,
  properties: {
    sub_user_id: {
      type: 'string',
      minLength: 1,
      pattern: '.*\\S.*',
      description: 'End-user identity for provider OAuth; use the same value for Probe and Call.',
    },
    tool_id: {
      type: 'string',
      minLength: 1,
      description: 'Capability ID to validate without executing it.',
    },
    parameters: {
      type: 'object',
      additionalProperties: true,
      default: {},
      description: 'Candidate parameters to validate.',
    },
    checks: {
      type: 'array',
      items: { type: 'string', enum: ['schema', 'quote', 'coverage', 'sample'] },
      minItems: 1,
      default: ['schema'],
      description: 'Probe checks to request. Schema and quote are implemented; coverage and sample may be unknown.',
    },
    live_budget: {
      type: 'string',
      enum: ['none', 'metadata', 'sampled'],
      default: 'none',
      description: 'Probe budget. Probe does not execute the capability or consume credits.',
    },
  },
  required: ['tool_id'],
};

export async function executeProbeTool(client: QverisClient, input: ProbeToolInput): Promise<ProbeResponse> {
  return client.probeTool(input.tool_id, {
    parameters: input.parameters ?? {},
    checks: input.checks ?? ['schema'],
    live_budget: input.live_budget ?? 'none',
    ...(input.sub_user_id !== undefined && { sub_user_id: input.sub_user_id }),
  });
}
