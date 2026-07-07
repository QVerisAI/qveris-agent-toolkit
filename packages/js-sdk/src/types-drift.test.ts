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
  it('js-sdk/src/types.ts matches packages/mcp/src/types.ts', () => {
    // Normalize line endings so the comparison is robust across platforms
    // (e.g. a Windows checkout with core.autocrlf converting one file to CRLF);
    // we guard the type content, not the checkout's line-ending style.
    const read = (relative: string) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

    expect(read('./types.ts')).toBe(read('../../mcp/src/types.ts'));
  });
});
