import { describe, expect, it, vi } from 'vitest';
import type { QverisClient } from '../api/client.js';
import { executeProbeTool, probeToolSchema } from './probe.js';

describe('probe', () => {
  it('declares the public probe inputs and defaults', () => {
    expect(probeToolSchema.required).toEqual(['tool_id']);
    expect(probeToolSchema.properties.checks.items.enum).toEqual(['schema', 'quote', 'coverage', 'sample']);
    expect(probeToolSchema.properties.live_budget.default).toBe('none');
  });

  it('maps MCP input to the API client', async () => {
    const probeTool = vi.fn().mockResolvedValue({ schema: { valid: true } });
    const client = { probeTool } as unknown as QverisClient;
    const result = await executeProbeTool(client, {
      tool_id: 'weather.tool.v1',
      parameters: { city: 'London' },
      checks: ['schema', 'quote'],
    });
    expect(probeTool).toHaveBeenCalledWith('weather.tool.v1', {
      parameters: { city: 'London' },
      checks: ['schema', 'quote'],
      live_budget: 'none',
    });
    expect(result.schema?.valid).toBe(true);
  });
});
