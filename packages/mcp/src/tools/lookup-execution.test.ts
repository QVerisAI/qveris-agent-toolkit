import { describe, expect, it, vi } from 'vitest';
import { executeLookupExecution, lookupExecutionSchema } from './lookup-execution.js';
import type { QverisClient } from '../api/client.js';

describe('lookup_execution', () => {
  it('requires a non-empty idempotency key', async () => {
    expect(lookupExecutionSchema.required).toEqual(['idempotency_key']);
    expect(lookupExecutionSchema.properties.idempotency_key.minLength).toBe(1);
    const lookup = vi.fn();

    await expect(
      executeLookupExecution(
        { hasIssuedExecutionKey: vi.fn(() => false), getExecutionByIdempotencyKey: lookup } as unknown as QverisClient,
        {
          idempotency_key: '  ',
        },
      ),
    ).rejects.toThrow(/non-empty/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('calls only the read-only key lookup endpoint', async () => {
    const response = { status: 'pending' };
    const lookup = vi.fn().mockResolvedValue(response);
    const hasIssuedExecutionKey = vi.fn(() => true);

    await expect(
      executeLookupExecution(
        { hasIssuedExecutionKey, getExecutionByIdempotencyKey: lookup } as unknown as QverisClient,
        {
          idempotency_key: 'retained-key',
        },
      ),
    ).resolves.toBe(response);
    expect(hasIssuedExecutionKey).toHaveBeenCalledWith('retained-key');
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('retained-key');
  });

  it('rejects an arbitrary model-supplied key without making a request', async () => {
    const lookup = vi.fn();
    await expect(
      executeLookupExecution(
        {
          hasIssuedExecutionKey: vi.fn(() => false),
          getExecutionByIdempotencyKey: lookup,
        } as unknown as QverisClient,
        { idempotency_key: 'invented-key' },
      ),
    ).rejects.toThrow(/not issued or bound/);
    expect(lookup).not.toHaveBeenCalled();
  });
});
