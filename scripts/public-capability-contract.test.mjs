import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [spec, javascriptTypes, pythonTypes, mcpTypes] = await Promise.all([
  readFile(new URL('docs/openapi/qveris-public-api.openapi.json', root), 'utf8').then(JSON.parse),
  readFile(new URL('packages/js-sdk/src/types.ts', root), 'utf8'),
  readFile(new URL('packages/python-sdk/qveris/types.py', root), 'utf8'),
  readFile(new URL('packages/mcp/src/types.ts', root), 'utf8'),
]);

test('hand-written client capability models track required public OpenAPI fields', () => {
  const capability = spec.components.schemas.PublicCapabilityResult;
  assert.deepEqual(capability.properties.params.type, [
    'object',
    'array',
    'string',
    'number',
    'boolean',
    'null',
  ]);
  assert.deepEqual(capability.required, [
    'tool_id',
    'verification_status',
    'verification',
    'execution_restrictions',
  ]);

  for (const source of [javascriptTypes, mcpTypes]) {
    assert.match(source, /export type JsonValue = string \| number \| boolean \| null/);
    assert.match(source, /verification_status: VerificationStatus/);
    assert.match(source, /verification: CatalogVerification/);
    assert.match(source, /execution_restrictions: ExecutionRestrictions/);
  }
  assert.match(pythonTypes, /params: Optional\[/);
  assert.match(pythonTypes, /verification_status: VerificationStatus/);
  assert.match(pythonTypes, /verification: CatalogVerification/);
  assert.match(pythonTypes, /execution_restrictions: ExecutionRestrictions/);
});

test('projected overflow models require only contract-guaranteed fields', () => {
  for (const source of [javascriptTypes, mcpTypes]) {
    assert.match(source, /interface ExecuteResultProjectedOverflow extends ExecuteResultTruncated/);
    assert.match(source, /message\?: string/);
  }
  assert.match(pythonTypes, /class ExecuteResultTruncated[\s\S]*?message: Optional\[str\] = None/);
});
