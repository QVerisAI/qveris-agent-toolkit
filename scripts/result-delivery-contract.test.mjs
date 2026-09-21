import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const contract = JSON.parse(await readFile(new URL('contracts/result-delivery.v1.json', root), 'utf8'));

const requiredVectorIds = [
  'explicit-full-default-over-20kb',
  'explicit-full-finite-one-megabyte',
  'omitted-default-overflow',
  'omitted-finite-overflow',
  'omitted-unlimited-inline',
  'fields-under-limit-inline',
  'fields-over-limit-overflow',
  'fields-unlimited-inline',
  'summary-default',
  'summary-finite',
  'summary-unlimited',
  'failure-null-data',
  'failure-missing-data',
  'utf8-multibyte-byte-count',
  'explicit-full-upstream-overflow-drift',
  'explicit-full-hard-limit',
];

test('shared result-delivery contract covers the cross-repository matrix', () => {
  assert.equal(contract.contract_id, 'qveris.result-delivery');
  assert.equal(contract.contract_version, '1.0.0');
  assert.deepEqual(contract.size_profiles, {
    over_default: { bytes: 20_481 },
    one_megabyte: { bytes: 1_048_576 },
    under_limit_after_projection: { bytes: 1_024 },
    near_gateway_limit: { bytes_from_gateway_limit: -1 },
  });
  assert.deepEqual(contract.vectors.map(({ id }) => id), requiredVectorIds);
  for (const vector of contract.vectors) {
    if (vector.payload_profile !== undefined) {
      assert.ok(
        Object.hasOwn(contract.size_profiles, vector.payload_profile),
        `${vector.id} references unknown payload profile ${vector.payload_profile}`,
      );
    }
  }
});

test('HTTP, JavaScript, Python, and Hosted MCP parameter mappings stay aligned', () => {
  assert.deepEqual(contract.parameter_mapping.http, {
    respond_with: 'respond_with',
    max_response_size: 'max_response_size',
  });
  assert.deepEqual(contract.parameter_mapping.javascript, {
    respondWith: 'respond_with',
    maxResponseSize: 'max_response_size',
  });
  assert.deepEqual(contract.parameter_mapping.python, contract.parameter_mapping.http);
  assert.deepEqual(contract.parameter_mapping.hosted_mcp, contract.parameter_mapping.http);
});

test('client sources implement the shared parameter names', async () => {
  const [javascript, python, mcp, javascriptTypes, pythonTypes, mcpTypes] = await Promise.all([
    readFile(new URL('packages/js-sdk/src/client.ts', root), 'utf8'),
    readFile(new URL('packages/python-sdk/qveris/client/api.py', root), 'utf8'),
    readFile(new URL('packages/mcp/src/tools/execute.ts', root), 'utf8'),
    readFile(new URL('packages/js-sdk/src/types.ts', root), 'utf8'),
    readFile(new URL('packages/python-sdk/qveris/types.py', root), 'utf8'),
    readFile(new URL('packages/mcp/src/types.ts', root), 'utf8'),
  ]);

  assert.match(javascript, /max_response_size: options\.maxResponseSize/);
  assert.match(javascript, /respond_with: options\.respondWith/);
  assert.match(python, /payload\["max_response_size"\] = max_response_size/);
  assert.match(python, /payload\["respond_with"\] = respond_with/);
  assert.match(mcp, /max_response_size: input\.max_response_size/);
  assert.match(mcp, /respond_with: input\.respond_with/);
  assert.match(javascriptTypes, /interface ExecuteResultProjectedOverflow/);
  assert.match(javascriptTypes, /\| ExecuteResultProjectedOverflow/);
  assert.match(javascriptTypes, /error_code\?: string \| null/);
  assert.match(pythonTypes, /error_code: Optional\[str\] = None/);
  assert.match(mcpTypes, /interface ExecuteResultProjectedOverflow/);
  assert.match(mcpTypes, /\| ExecuteResultProjectedOverflow/);
  assert.match(mcpTypes, /error_code\?: string \| null/);
});
