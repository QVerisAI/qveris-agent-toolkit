import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { executeQverisMcpTool } from './index.js';
import type { QverisClient } from './api/client.js';

interface ProbeCase {
  name: string;
  catalog: Record<string, unknown>;
  probe: string | null;
  next_action: string;
  safe_fix?: string;
  callable: boolean;
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/tool-access-guidance.v1.json', import.meta.url), 'utf8'),
) as {
  probe_cases: ProbeCase[];
  tool_id: string;
  parameters: Record<string, string>;
};
const expected: Record<string, string> = {
  execute: 'review_and_call',
  switch_provider: 'select_allowed_provider',
  insufficient_scope: 'request_qveris_execute_scope',
  oauth2_signin_required: 'sign_in_to_provider',
  delegation_budget_not_supported: 'change_delegation_or_select_provider',
  invalid_schema: 'correct_parameters',
  unknown_quote: 'confirm_budget',
};

for (const row of fixture.probe_cases) {
  if (row.probe === null) continue;
  it(`presents producer fixture: ${row.name}`, async () => {
    const denied = [
      'insufficient_scope',
      'oauth2_signin_required',
      'delegation_budget_not_supported',
      'tool_unavailable',
    ].includes(row.probe ?? '');
    const wire = {
      executable: !denied,
      ...(denied && { reason: row.probe }),
      execution_restrictions: { ...row.catalog, callable: row.callable, next_action: row.next_action },
      recovery: { next_action: row.next_action, safe_fixes: row.safe_fix ? [row.safe_fix] : [] },
      schema: { valid: row.probe !== 'invalid_schema' },
      quote: { currency: 'credits', exact: row.probe !== 'unknown_quote', estimate_credits: 0 },
    };
    const executeTool = vi.fn();
    const client = { probeTool: vi.fn().mockResolvedValue(wire), executeTool } as unknown as QverisClient;
    const result = await executeQverisMcpTool(client, 'session', 'probe', {
      tool_id: fixture.tool_id,
      parameters: fixture.parameters,
      checks: ['schema', 'quote'],
    });
    expect(result.structuredContent).toMatchObject({
      ...wire,
      execution_guidance: { action: expected[row.probe ?? ''] ?? expected[row.next_action], automatic: false },
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
}

it('does not confirm billing, preflight or execute a Call with a public context', async () => {
  const probeTool = vi.fn();
  const executeTool = vi.fn();
  const confirm = vi.fn();
  const client = { probeTool, executeTool } as unknown as QverisClient;
  const result = await executeQverisMcpTool(
    client,
    'session',
    'call',
    {
      tool_id: fixture.tool_id,
      search_id: 'pub_example',
      params_to_tool: fixture.parameters,
      require_zero_quote: true,
    },
    undefined,
    confirm,
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    code: 'AUTH_PUBLIC_CONTEXT',
    next_action: { action: 'connect_qveris_execution' },
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(probeTool).not.toHaveBeenCalled();
  expect(executeTool).not.toHaveBeenCalled();
});

it('reports restricted zero-quote preflight without dispatch or settlement recovery', async () => {
  const executeTool = vi.fn();
  const client = {
    probeTool: vi.fn().mockResolvedValue({ executable: false, reason: 'delegation_budget_not_supported' }),
    executeTool,
  } as unknown as QverisClient;
  const result = await executeQverisMcpTool(client, 'session', 'call', {
    tool_id: fixture.tool_id,
    search_id: 'authenticated-context',
    params_to_tool: fixture.parameters,
    require_zero_quote: true,
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    next_action: { action: 'change_delegation_or_select_provider', reason: 'delegation_budget_not_supported' },
  });
  expect(executeTool).not.toHaveBeenCalled();
});
