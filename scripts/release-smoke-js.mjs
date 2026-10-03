// Runs from a copied file in an isolated consumer directory, never the checkout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Qveris, QverisApiError, AgentDelegationCredentialProvider } from '@qverisai/sdk';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
assert.equal(typeof AgentDelegationCredentialProvider, 'function');
const client = new Qveris({ apiKey: 'fixture-credential', baseUrl: 'https://qveris.ai/api/v1', maxRetries: 3 });
let requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  assert.equal(init.redirect, 'error');
  return new Response(
    JSON.stringify(fixtures[init.method === 'GET' ? 'capability_detail' : 'capability_query'].response),
  );
};
const detail = await client.capabilityDetail('MKT/BARS');
assert.equal(detail.capability_id, fixtures.capability_detail.response.capability_id);
assert.ok(requests[0].url.includes('MKT%2FBARS'));
const result = await client.capabilityQuery(fixtures.capability_query.request);
assert.equal(result.execution_id, fixtures.capability_query.response.execution_id);
assert.deepEqual(JSON.parse(requests[1].init.body), fixtures.capability_query.request);

for (const status of [401, 429, 503, 307, 308]) {
  requests = [];
  globalThis.fetch = async (...args) => {
    requests.push(args);
    return new Response(JSON.stringify({ message: 'fixture failure' }), { status, headers: { 'Retry-After': '0' } });
  };
  await assert.rejects(client.capabilityQuery({ query: 'weather' }), QverisApiError);
  assert.equal(requests.length, 1, `Query replayed HTTP ${status}`);
}
for (const kind of ['network', 'timeout', 'invalid_json', 'invalid_contract', 'execution_identity']) {
  requests = [];
  globalThis.fetch = async (...args) => {
    requests.push(args);
    if (kind === 'network') throw new Error('synthetic transport failure');
    if (kind === 'timeout') throw new DOMException('synthetic timeout', 'AbortError');
    return new Response(
      kind === 'invalid_json'
        ? '{'
        : JSON.stringify({
            success: 'true',
            ...(kind === 'execution_identity' ? { execution_id: 'fixture-execution' } : {}),
          }),
    );
  };
  await assert.rejects(client.capabilityQuery({ query: 'weather' }), (error) => {
    assert.equal(error.next_action.automatic, false);
    assert.equal(
      error.next_action.action,
      kind === 'execution_identity' ? 'reconcile_settlement' : 'review_settlement',
    );
    if (kind === 'execution_identity') assert.equal(error.details.execution_id, 'fixture-execution');
    return true;
  });
  assert.equal(requests.length, 1);
}
requests = [];
await assert.rejects(client.capabilityQuery({ query: ' ' }));
await assert.rejects(client.capabilityQuery({ query: 'weather', max_credits: Infinity }));
assert.equal(requests.length, 0);
console.log('Installed JS package: exports, Detail/Query, single-submit and recovery passed');
