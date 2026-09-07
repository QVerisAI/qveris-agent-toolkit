import { describe, expect, it } from 'vitest';

import { supportsParameters } from '../examples/contract.js';
import type { ToolInfo, ToolParameter } from './types.js';

function tool(params?: ToolParameter[]): ToolInfo {
  return { tool_id: 'provider.tool', params };
}

function parameter(name: string, type: string, required = false, values?: string[]): ToolParameter {
  return { name, type: type as ToolParameter['type'], required, description: '', enum: values };
}

describe('example parameter contract selection', () => {
  it('accepts compatible JSON values and enum members', () => {
    expect(
      supportsParameters(
        tool([
          parameter('city', 'string', true, ['London', 'Paris']),
          parameter('days', 'number'),
          parameter('alerts', 'boolean'),
          parameter('tags', 'array'),
          parameter('options', 'object'),
        ]),
        { city: 'London', days: 3, alerts: false, tags: [], options: {} },
      ),
    ).toBe(true);
  });

  it.each([
    ['wrong type', tool([parameter('city', 'string', true)]), { city: 42 }],
    ['enum mismatch', tool([parameter('city', 'string', true, ['Paris'])]), { city: 'London' }],
    ['missing required input', tool([parameter('city', 'string', true)]), {}],
    ['unsupported input', tool([parameter('city', 'string')]), { symbol: 'AAPL' }],
    ['unknown contract type', tool([parameter('city', 'date')]), { city: '2026-09-07' }],
    ['non-finite number', tool([parameter('days', 'number')]), { days: Number.NaN }],
    ['array passed as object', tool([parameter('options', 'object')]), { options: [] }],
    ['duplicate definitions', tool([parameter('city', 'string'), parameter('city', 'string')]), { city: 'London' }],
  ])('rejects %s', (_label, candidate, requested) => {
    expect(supportsParameters(candidate, requested)).toBe(false);
  });
});
