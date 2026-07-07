import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `packages/js-sdk/src/types.ts` is a maintained copy of
 * `packages/mcp/src/types.ts` — the JS SDK deliberately mirrors the MCP
 * server's response types (which track the OpenAPI contract). This guard
 * fails if the two ever drift, e.g. after an OpenAPI regen updates the MCP
 * types but the copy is not refreshed. When it fails, re-copy:
 *
 *   cp packages/mcp/src/types.ts packages/js-sdk/src/types.ts
 */
describe('type definitions stay in sync with @qverisai/mcp', () => {
  it('js-sdk/src/types.ts is byte-identical to packages/mcp/src/types.ts', () => {
    const jsSdkTypes = readFileSync(fileURLToPath(new URL('./types.ts', import.meta.url)), 'utf8');
    const mcpTypes = readFileSync(
      fileURLToPath(new URL('../../mcp/src/types.ts', import.meta.url)),
      'utf8',
    );

    expect(jsSdkTypes).toBe(mcpTypes);
  });
});
