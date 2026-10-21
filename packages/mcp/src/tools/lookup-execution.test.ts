import { describe, expect, it, vi } from 'vitest';
import { executeLookupExecution, lookupExecutionSchema } from './lookup-execution.js';
import type { QverisClient } from '../api/client.js';

describe('lookup_execution', () => {
  it('requires a non-empty idempotency key', async () => {
    expect(lookupExecutionSchema.required).toEqual(['idempotency_key']);
    expect(lookupExecutionSchema.properties.idempotency_key.minLength).toBe(1);
    const lookup = vi.fn();

    await expect(
      executeLookupExecution({ getExecutionByIdempotencyKey: lookup } as unknown as QverisClient, {
        idempotency_key: '  ',
      }),
    ).rejects.toThrow(/non-empty/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('calls only the read-only key lookup endpoint', async () => {
    const response = { status: 'pending' };
    const lookup = vi.fn().mockResolvedValue(response);

    await expect(
      executeLookupExecution({ getExecutionByIdempotencyKey: lookup } as unknown as QverisClient, {
        idempotency_key: 'retained-key',
      }),
    ).resolves.toBe(response);
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('retained-key');
  });
});
