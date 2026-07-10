/**
 * Output schemas for the QVeris MCP tools (MCP spec 2025-06-18).
 *
 * Declaring `outputSchema` lets clients and models consume `structuredContent`
 * as typed data instead of re-parsing a JSON string out of the text content.
 * The schemas are deliberately LOOSE (`additionalProperties: true`, only the
 * stable key fields pinned) because the API evolves additively — a new server
 * field must never make client-side validation reject a result.
 */

const searchResponseSchema = {
  type: 'object',
  properties: {
    search_id: { type: 'string', description: 'Discovery id; thread into inspect/call.' },
    total: { type: 'number' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          why_recommended: { type: 'string' },
          expected_cost: {},
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

const executeResponseSchema = {
  type: 'object',
  properties: {
    execution_id: { type: 'string', description: 'Correlates with usage/ledger records.' },
    success: { type: 'boolean' },
    result: {},
    billing: { type: 'object', additionalProperties: true },
    remaining_credits: { type: 'number' },
  },
  additionalProperties: true,
} as const;

const auditResponseSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string' },
    shown_records: { type: 'number' },
    matched_records: { type: 'number' },
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  additionalProperties: true,
} as const;

/** outputSchema per canonical tool name (deprecated aliases share them). */
export const TOOL_OUTPUT_SCHEMAS: Record<string, object> = {
  discover: searchResponseSchema,
  inspect: searchResponseSchema,
  call: executeResponseSchema,
  usage_history: auditResponseSchema,
  credits_ledger: auditResponseSchema,
};
