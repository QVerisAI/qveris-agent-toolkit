import { describe, expect, it } from 'vitest';

import { supportsParameters } from '../examples/_shared.js';

describe('MCP example parameter contract selection', () => {
  const candidate = {
    tool_id: 'provider.tool',
    params: [
      { name: 'symbol', type: 'string', required: true, enum: ['AAPL'] },
      { name: 'limit', type: 'integer' },
    ],
  };

  it('accepts values that match type and enum constraints', () => {
    expect(supportsParameters(candidate, { symbol: 'AAPL', limit: 10 })).toBe(true);
  });

  it.each([{ symbol: 'MSFT' }, { symbol: 'AAPL', limit: 1.5 }, { symbol: 'AAPL', extra: true }])(
    'rejects incompatible parameters %#',
    (requested) => {
      expect(supportsParameters(candidate, requested)).toBe(false);
    },
  );
});
