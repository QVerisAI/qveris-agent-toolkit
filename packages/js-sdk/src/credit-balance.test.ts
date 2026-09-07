import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { normalizeCreditBalance, normalizeCreditBalanceResponse } from './credit-balance.js';

const contract = JSON.parse(
  readFileSync(new URL('../../../test-fixtures/credit-balance-contract.json', import.meta.url), 'utf8'),
) as { cases: Array<{ name: string; input: unknown; expected: number | null; invalid: boolean }> };

describe('credit balance response contract', () => {
  it.each(contract.cases)('normalizes $name', ({ input, expected, invalid }) => {
    expect(normalizeCreditBalance(input)).toEqual({ value: expected, invalid });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite number %s', (input) => {
    expect(normalizeCreditBalance(input)).toEqual({ value: null, invalid: true });
  });

  it('normalizes raw and enveloped responses without traversing capability results', () => {
    const warn = vi.fn();
    expect(normalizeCreditBalanceResponse({ remaining_credits: '12.5' }, warn)).toEqual({ remaining_credits: 12.5 });
    expect(normalizeCreditBalanceResponse({ status: 'success', data: { remaining_credits: '0' } }, warn)).toEqual({
      status: 'success',
      data: { remaining_credits: 0 },
    });
    const capabilityResult = { result: { data: { remaining_credits: 'provider-defined' } } };
    expect(normalizeCreditBalanceResponse(capabilityResult, warn)).toBe(capabilityResult);
    expect(warn).not.toHaveBeenCalled();
  });

  it('converts an invalid balance to null and emits one diagnostic', () => {
    const warn = vi.fn();
    expect(normalizeCreditBalanceResponse({ remaining_credits: 'unavailable' }, warn)).toEqual({
      remaining_credits: null,
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
