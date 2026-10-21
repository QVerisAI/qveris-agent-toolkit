import type { QverisClient } from '../api/client.js';
import type { ExecutionLookupResponse } from '../types.js';

export interface LookupExecutionInput {
  idempotency_key: string;
}

export const lookupExecutionSchema = {
  type: 'object' as const,
  properties: {
    idempotency_key: {
      type: 'string',
      minLength: 1,
      description: 'The exact key used for the original Call. This lookup is read-only and never submits a Call.',
    },
  },
  required: ['idempotency_key'],
};

/** Read-only lookup for the result associated with an earlier Call key. */
export async function executeLookupExecution(
  client: QverisClient,
  input: LookupExecutionInput,
): Promise<ExecutionLookupResponse> {
  if (typeof input.idempotency_key !== 'string' || input.idempotency_key.trim().length === 0) {
    throw new Error('idempotency_key must be a non-empty string.');
  }
  const response = await client.getExecutionByIdempotencyKey(input.idempotency_key);
  if (response && typeof response === 'object') {
    const envelope = response as { status?: unknown; data?: unknown };
    if (typeof envelope.status === 'string' && 'data' in envelope) return envelope.data as ExecutionLookupResponse;
  }
  return response as ExecutionLookupResponse;
}
