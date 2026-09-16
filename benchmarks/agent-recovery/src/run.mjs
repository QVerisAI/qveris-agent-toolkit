#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCall } from '../../../packages/cli/src/commands/call.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = resolve(HERE, '../fixtures/v1.json');
const TEST_KEY = ['sk', 'fixture'].join('-');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function tool(overrides = {}) {
  return {
    tool_id: 'provider.company.lookup.v1',
    service_id: 'service.market-data.v1',
    provider_id: 'primary',
    params: [{ name: 'symbol', type: 'string', required: true }],
    ...overrides,
  };
}

function installContext(testCase) {
  const now = Math.floor(Date.now() / 1000);
  const serviceOnly = testCase.scenario === 'service_only';
  return JSON.stringify({
    context_version: 1,
    context_issued_at: now - 120,
    context_expires_at: testCase.scenario === 'expired' ? now - 1 : now + 600,
    task_id: 'company-latest-filing',
    service_id: 'service.market-data.v1',
    ...(!serviceOnly && { tool_id: 'provider.company.lookup.v1' }),
    ...(testCase.scenario === 'extension' && { future_display_hint: 'compact' }),
  });
}

function handlerFor(testCase) {
  let searchCount = 0;
  return (request) => {
    const path = request.url.pathname;
    const scenario = testCase.scenario;
    if (path.endsWith('/search')) {
      searchCount += 1;
      if (scenario === 'permission') return jsonResponse({ message: 'missing scope' }, 403);
      if (scenario === 'fallback') {
        if (searchCount === 1) return jsonResponse({ search_id: 'search-primary', results: [] });
        return jsonResponse({
          search_id: 'search-fallback',
          results: [
            tool({ tool_id: 'provider.company.lookup.fallback.v1', provider_id: 'fallback', expected_cost: 0 }),
          ],
        });
      }
      if (scenario === 'service_only') {
        return jsonResponse({ search_id: 'search-service', results: [tool({ expected_cost: 0 })] });
      }
      if (scenario === 'inspect') {
        return jsonResponse({ search_id: 'search-inspect', results: [tool({ params: undefined, expected_cost: 0 })] });
      }
      if (scenario === 'quote_missing') {
        return jsonResponse({ search_id: 'search-quote', results: [tool({ expected_cost: '2 credits' })] });
      }
      return jsonResponse({ search_id: `search-${scenario}`, results: [tool()] });
    }
    if (path.endsWith('/tools/by-ids')) return jsonResponse({ results: [tool({ expected_cost: 0 })] });
    if (path.endsWith('/tools/probe')) return jsonResponse({ schema: { valid: true } });
    if (path.endsWith('/tools/execute')) {
      if (scenario === 'balance') return jsonResponse({ message: 'balance too low' }, 402);
      if (scenario === 'upstream') return jsonResponse({ execution_id: 'exec-upstream', success: false });
      if (scenario === 'settlement') {
        return jsonResponse({ message: 'gateway timed out', execution_id: 'exec-pending' }, 504);
      }
      return jsonResponse({ execution_id: `exec-${scenario}`, success: true, result: { ok: true } });
    }
    if (path.endsWith('/auth/usage/history/v2')) {
      return jsonResponse({ items: [{ execution_id: 'exec-pending', charge_outcome: 'pending' }], total: 1 });
    }
    if (path.endsWith('/auth/credits/ledger')) return jsonResponse({ items: [], total: 0 });
    throw new Error(`Unexpected fixture request ${path}`);
  };
}

async function captureOutput(fn) {
  const stdout = [];
  const original = process.stdout.write;
  process.stdout.write = function write(chunk, ...args) {
    stdout.push(String(chunk));
    const callback = args.find((arg) => typeof arg === 'function');
    callback?.();
    return true;
  };
  try {
    return { value: await fn(), stdout: stdout.join('') };
  } finally {
    process.stdout.write = original;
  }
}

function classify(error, output) {
  if (output?.status === 'candidates') return 'needs_user';
  if (output?.status === 'unknown_settlement') return 'unknown_settlement';
  if (output?.success === true) return 'success';
  if (output?.success === false) return 'failed';
  if (output?.recovery?.action === 'reconcile_settlement' || error?.action === 'reconcile_settlement') {
    return 'unknown_settlement';
  }
  if (
    ['AUTH_INVALID_KEY', 'PERMISSION_DENIED', 'CREDITS_INSUFFICIENT', 'CONTEXT_QUOTE_REQUIRED'].includes(error?.code)
  ) {
    return 'blocked';
  }
  return 'failed';
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function summarize(records) {
  const count = records.length;
  const sum = (predicate) => records.filter(predicate).length;
  const rounds = records.map((record) => record.api_calls);
  const recovery = records.filter((record) => record.recovery_attempts > 0);
  const usable = records.filter((record) => record.usable);
  return {
    fixture_cases: count,
    first_attempt_task_completion_rate: sum((record) => record.completed && record.recovery_attempts === 0) / count,
    task_completion_rate: sum((record) => record.completed) / count,
    api_call_rounds: {
      mean: rounds.reduce((total, value) => total + value, 0) / count,
      p50: percentile(rounds, 0.5),
      p95: percentile(rounds, 0.95),
    },
    discover_hit_rate: sum((record) => record.discover_hit) / count,
    contract_rejection_rate: sum((record) => record.contract_rejected) / count,
    automatic_recovery: {
      attempts: recovery.length,
      success_rate: recovery.length ? recovery.filter((record) => record.completed).length / recovery.length : 0,
    },
    provider_tool_fallback_success_rate:
      sum((record) => record.fallback_succeeded) / sum((record) => record.fallback_attempted) || 0,
    unknown_price_continuation_rate:
      sum((record) => record.unknown_price_continued) / sum((record) => record.unknown_price_observed) || 0,
    user_interventions: sum((record) => record.user_intervention),
    usable_tool_false_rejection_rate: usable.filter((record) => record.false_rejection).length / (usable.length || 1),
  };
}

export async function runFixtureBenchmark(fixturePath = DEFAULT_FIXTURES) {
  const fixtureSet = JSON.parse(await readFile(fixturePath, 'utf8'));
  const records = [];
  for (const testCase of fixtureSet.cases) {
    const originalFetch = globalThis.fetch;
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    const requests = [];
    const handleRequest = handlerFor(testCase);
    globalThis.fetch = async (url, options = {}) => {
      const request = {
        url: new URL(url),
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      requests.push(request);
      return handleRequest(request);
    };
    let error;
    let output;
    try {
      const captured = await captureOutput(() =>
        runCall(undefined, {
          apiKey: TEST_KEY,
          baseUrl: 'https://fixture.invalid/api/v1',
          context: installContext(testCase),
          params: '{"symbol":"ACME"}',
          json: true,
        }),
      );
      output = captured.stdout.trim() ? JSON.parse(captured.stdout) : captured.value;
    } catch (caught) {
      error = caught;
    } finally {
      process.exitCode = originalExitCode;
      globalThis.fetch = originalFetch;
    }
    const outcome = classify(error, output);
    const searchCalls = requests.filter((request) => request.url.pathname.endsWith('/search'));
    const fallbackAttempted = searchCalls.length > 1;
    const recoveryAttempts =
      (testCase.scenario === 'expired' && searchCalls.length > 0 ? 1 : 0) +
      (requests.some((request) => request.url.pathname.endsWith('/tools/by-ids')) ? 1 : 0) +
      (fallbackAttempted ? 1 : 0) +
      (requests.some((request) => request.url.pathname.includes('/auth/usage/history')) ? 1 : 0);
    const contractRejected = Boolean(error?.code?.startsWith('CONTEXT_') || error?.code === 'PERMISSION_DENIED');
    const completed = outcome === 'success';
    records.push({
      id: testCase.id,
      expected: testCase.expected,
      outcome,
      completed,
      expected_outcome_observed: outcome === testCase.expected,
      usable: testCase.usable,
      api_calls: requests.length,
      discover_hit:
        searchCalls.some((request, index) => index === 0) &&
        !(testCase.scenario === 'fallback' && searchCalls.length === 1),
      contract_rejected: contractRejected,
      recovery_attempts: recoveryAttempts,
      fallback_attempted: fallbackAttempted,
      fallback_succeeded: fallbackAttempted && completed,
      unknown_price_observed: ['ordinary', 'expired', 'extension'].includes(testCase.scenario),
      unknown_price_continued: ['ordinary', 'expired', 'extension'].includes(testCase.scenario) && completed,
      user_intervention: ['needs_user', 'blocked', 'unknown_settlement'].includes(outcome),
      false_rejection: testCase.usable && !completed && outcome !== 'needs_user',
      error_code: error?.code ?? null,
      next_action: error?.nextAction ?? output?.next_action ?? output?.recovery?.next_action ?? null,
      paths: requests.map((request) => request.url.pathname),
    });
  }
  return {
    schema_version: 1,
    lane: 'deterministic_fixture',
    production_success_claim: false,
    fixture_source: 'fixtures/v1.json',
    summary: summarize(records),
    records,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--live')) {
    throw new Error('Live smoke is intentionally separate; use src/live-smoke.mjs with explicit credentials.');
  }
  const outputIndex = args.indexOf('--output');
  const result = await runFixtureBenchmark();
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputIndex >= 0) await writeFile(resolve(args[outputIndex + 1]), serialized, 'utf8');
  else process.stdout.write(serialized);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
