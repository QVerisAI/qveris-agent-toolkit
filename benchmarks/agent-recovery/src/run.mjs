#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCall } from '../../../packages/cli/src/commands/call.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = resolve(HERE, '../fixtures/v2.json');
const TEST_KEY = ['sk', 'fixture'].join('-');
const OUTCOMES = new Set(['success', 'needs_user', 'blocked', 'failed', 'unknown_settlement']);
const INTERVENTIONS = new Set(['none', 'tool_selection', 'quote', 'permission', 'credits']);
const INTERVENTION_ACTIONS = {
  select_tool: 'tool_selection',
  refresh_quote_or_change_budget_policy: 'quote',
  request_permission: 'permission',
  add_credits: 'credits',
};

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

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function validateFixtureSet(fixtureSet) {
  if (fixtureSet?.schema_version !== 2 || !Array.isArray(fixtureSet.cases) || fixtureSet.cases.length === 0) {
    throw new Error('Fixture set must use schema_version 2 and contain at least one case');
  }
  const ids = new Set();
  for (const testCase of fixtureSet.cases) {
    if (typeof testCase.id !== 'string' || !testCase.id || ids.has(testCase.id)) {
      throw new Error(`Fixture case has an invalid or duplicate id: ${testCase.id ?? '<missing>'}`);
    }
    ids.add(testCase.id);
    if (typeof testCase.scenario !== 'string' || !testCase.scenario) {
      throw new Error(`Fixture ${testCase.id} must declare a scenario`);
    }
    if (!OUTCOMES.has(testCase.expected_outcome)) {
      throw new Error(`Fixture ${testCase.id} has an invalid expected_outcome`);
    }
    for (const field of ['completion_eligible', 'autonomous_completion_eligible', 'recovery_expected']) {
      if (typeof testCase[field] !== 'boolean') throw new Error(`Fixture ${testCase.id} must declare ${field}`);
    }
    if (!INTERVENTIONS.has(testCase.expected_intervention)) {
      throw new Error(`Fixture ${testCase.id} has an invalid expected_intervention`);
    }
    if (testCase.autonomous_completion_eligible && !testCase.completion_eligible) {
      throw new Error(`Fixture ${testCase.id} cannot be autonomous when completion is ineligible`);
    }
    if (testCase.autonomous_completion_eligible && testCase.expected_intervention !== 'none') {
      throw new Error(`Fixture ${testCase.id} cannot require intervention when autonomous completion is eligible`);
    }
    if (testCase.expected_outcome === 'success' && !testCase.completion_eligible) {
      throw new Error(`Fixture ${testCase.id} cannot expect success when completion is ineligible`);
    }
  }
  return fixtureSet;
}

export function summarize(records) {
  const count = records.length;
  const sum = (predicate) => records.filter(predicate).length;
  const rounds = records.map((record) => record.api_calls);
  const completionEligible = records.filter((record) => record.completion_eligible);
  const autonomousEligible = records.filter((record) => record.autonomous_completion_eligible);
  const nonAutonomous = records.filter((record) => !record.autonomous_completion_eligible);
  const recovery = records.filter((record) => record.recovery_expected);
  const interventionExpected = records.filter((record) => record.expected_intervention !== 'none');
  const interventionNotExpected = records.filter((record) => record.expected_intervention === 'none');
  const fallbackAttempts = sum((record) => record.fallback_attempted);
  const unknownPriceCases = sum((record) => record.unknown_price_observed);
  return {
    fixture_cases: count,
    expected_outcome_rate: rate(
      sum((record) => record.expected_outcome_observed),
      count,
    ),
    completion: {
      eligible_cases: completionEligible.length,
      eligible_task_completion_rate: rate(
        completionEligible.filter((record) => record.completed).length,
        completionEligible.length,
      ),
      autonomous_eligible_cases: autonomousEligible.length,
      autonomous_task_completion_rate: rate(
        autonomousEligible.filter((record) => record.completed).length,
        autonomousEligible.length,
      ),
      first_attempt_autonomous_completion_rate: rate(
        autonomousEligible.filter((record) => record.completed && record.recovery_attempts === 0).length,
        autonomousEligible.length,
      ),
      all_fixture_completion_rate: rate(
        sum((record) => record.completed),
        count,
      ),
    },
    recovery: {
      cases: recovery.length,
      attempted_rate: rate(recovery.filter((record) => record.recovery_attempts > 0).length, recovery.length),
      expected_outcome_rate: rate(
        recovery.filter((record) => record.expected_outcome_observed).length,
        recovery.length,
      ),
      task_completion_rate: rate(recovery.filter((record) => record.completed).length, recovery.length),
      unresolved_rate: rate(
        recovery.filter((record) => record.outcome === 'unknown_settlement').length,
        recovery.length,
      ),
      failed_rate: rate(recovery.filter((record) => record.outcome === 'failed').length, recovery.length),
    },
    intervention: {
      expected_cases: interventionExpected.length,
      observed_cases: sum((record) => record.observed_intervention !== 'none'),
      correct_action_rate: rate(
        interventionExpected.filter((record) => record.observed_intervention === record.expected_intervention).length,
        interventionExpected.length,
      ),
      unexpected_action_rate: rate(
        interventionNotExpected.filter((record) => record.observed_intervention !== 'none').length,
        interventionNotExpected.length,
      ),
      expected_by_reason: Object.fromEntries(
        [...INTERVENTIONS]
          .filter((reason) => reason !== 'none')
          .map((reason) => [
            reason,
            interventionExpected.filter((record) => record.expected_intervention === reason).length,
          ]),
      ),
    },
    safety: {
      autonomous_false_rejection_rate: rate(
        autonomousEligible.filter((record) => record.false_rejection).length,
        autonomousEligible.length,
      ),
      unexpected_contract_rejection_rate: rate(
        autonomousEligible.filter((record) => record.contract_rejected).length,
        autonomousEligible.length,
      ),
      non_autonomous_outcome_accuracy: rate(
        nonAutonomous.filter((record) => record.expected_outcome_observed).length,
        nonAutonomous.length,
      ),
      submitted_calls: records.reduce((total, record) => total + record.execute_calls, 0),
      replayed_submitted_calls: sum((record) => record.submitted_call_replayed),
    },
    efficiency: {
      api_call_rounds: {
        mean: rate(
          rounds.reduce((total, value) => total + value, 0),
          count,
        ),
        p50: percentile(rounds, 0.5),
        p95: percentile(rounds, 0.95),
      },
    },
    discovery: {
      hit_rate: rate(
        sum((record) => record.discover_hit),
        count,
      ),
    },
    fallback: {
      attempts: fallbackAttempts,
      success_rate: rate(
        sum((record) => record.fallback_succeeded),
        fallbackAttempts,
      ),
    },
    pricing: {
      unknown_price_cases: unknownPriceCases,
      continuation_rate: rate(
        sum((record) => record.unknown_price_continued),
        unknownPriceCases,
      ),
    },
  };
}

export async function runFixtureBenchmark(fixturePath = DEFAULT_FIXTURES) {
  const fixtureSet = validateFixtureSet(JSON.parse(await readFile(fixturePath, 'utf8')));
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
      const response = await handleRequest(request);
      request.response_ok = response.ok;
      if (request.url.pathname.endsWith('/search') && response.ok) {
        const payload = await response.clone().json();
        request.candidate_count = Array.isArray(payload?.results) ? payload.results.length : 0;
      }
      return response;
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
    const nextAction = error?.nextAction ?? output?.next_action ?? output?.recovery?.next_action ?? null;
    const searchCalls = requests.filter((request) => request.url.pathname.endsWith('/search'));
    const executeCalls = requests.filter((request) => request.url.pathname.endsWith('/tools/execute'));
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
      expected_outcome: testCase.expected_outcome,
      outcome,
      completed,
      expected_outcome_observed: outcome === testCase.expected_outcome,
      completion_eligible: testCase.completion_eligible,
      autonomous_completion_eligible: testCase.autonomous_completion_eligible,
      recovery_expected: testCase.recovery_expected,
      expected_intervention: testCase.expected_intervention,
      observed_intervention:
        nextAction?.requires_user === true ? (INTERVENTION_ACTIONS[nextAction.action] ?? 'other') : 'none',
      api_calls: requests.length,
      execute_calls: executeCalls.length,
      submitted_call_replayed: executeCalls.length > 1,
      discover_hit: searchCalls[0]?.response_ok === true && searchCalls[0]?.candidate_count > 0,
      contract_rejected: contractRejected,
      recovery_attempts: recoveryAttempts,
      fallback_attempted: fallbackAttempted,
      fallback_succeeded: fallbackAttempted && completed,
      unknown_price_observed: ['ordinary', 'expired', 'extension'].includes(testCase.scenario),
      unknown_price_continued: ['ordinary', 'expired', 'extension'].includes(testCase.scenario) && completed,
      false_rejection: testCase.autonomous_completion_eligible && !completed,
      error_code: error?.code ?? null,
      next_action: nextAction,
      paths: requests.map((request) => request.url.pathname),
    });
  }
  return {
    schema_version: 2,
    lane: 'deterministic_fixture',
    production_success_claim: false,
    fixture_source: 'fixtures/v2.json',
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
