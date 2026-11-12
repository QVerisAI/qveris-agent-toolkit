import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  catalogExecutionGuidance,
  probeExecutionGuidance,
  withCatalogExecutionGuidance,
} from "../src/utils/execution-guidance.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../../contracts/tool-access-guidance.v1.json", import.meta.url)));
const expected = {
  execute: "review_and_call",
  switch_provider: "select_allowed_provider",
  insufficient_scope: "request_qveris_execute_scope",
  oauth2_signin_required: "sign_in_to_provider",
  delegation_budget_not_supported: "change_delegation_or_select_provider",
  invalid_schema: "correct_parameters",
  unknown_quote: "confirm_budget",
};

test("both generations of public guidance identify the QVeris boundary and never offer public Call", () => {
  const { feature, context: _context, verification_status, ...restrictions } = fixture.public;
  for (const legacy of [false, true]) {
    const tool = {
      tool_id: fixture.tool_id,
      verification_status,
      execution_restrictions: legacy
        ? { callable: false, authentication: "required", next_action: "authorize" }
        : restrictions,
    };
    const wire = {
      search_id: "pub_example",
      contract_features: ["public-readonly-v1", ...(!legacy ? [feature] : [])],
      results: [tool],
    };
    const result = withCatalogExecutionGuidance(wire);
    assert.equal(result.execution_guidance.action, "connect_qveris_execution");
    assert.deepEqual(result.execution_guidance.allowed_actions, ["discover", "inspect"]);
    assert.match(result.execution_guidance.message, /qveris auth login.*qveris inspect <tool-id>/);
    assert.deepEqual(result.results[0], tool);
  }
});

for (const row of fixture.probe_cases) {
  test(`Website fixture: ${row.name}`, () => {
    const execution_restrictions = { ...row.catalog, callable: row.callable, next_action: row.next_action };
    if (!row.probe) {
      const advice = catalogExecutionGuidance({ execution_restrictions });
      assert.equal(advice?.action, row.callable ? undefined : "inspect_then_probe_once");
      return;
    }
    const denied = [
      "insufficient_scope",
      "oauth2_signin_required",
      "delegation_budget_not_supported",
      "tool_unavailable",
    ].includes(row.probe);
    const result = {
      executable: !denied,
      ...(denied && { reason: row.probe }),
      execution_restrictions,
      recovery: { next_action: row.next_action, safe_fixes: row.safe_fix ? [row.safe_fix] : [] },
      schema: { valid: row.probe !== "invalid_schema" },
      quote: { currency: "credits", exact: row.probe !== "unknown_quote", estimate_credits: 0 },
    };
    const advice = probeExecutionGuidance(result, { requireQuote: true });
    assert.equal(advice.action, expected[row.probe] ?? expected[row.next_action]);
    assert.equal(advice.automatic, false);
  });
}

test("contradictory and unknown actions stop without replay and transient failures suggest a bounded read", () => {
  const base = {
    executable: true,
    schema: { valid: true },
    quote: { currency: "credits", exact: true, estimate_credits: 0 },
  };
  assert.equal(probeExecutionGuidance(base).action, "review_and_call");
  for (const extra of [
    { execution_restrictions: { callable: false, next_action: "inspect" }, recovery: { next_action: "inspect" } },
    { execution_restrictions: { callable: true, blocked_actions: ["execute"] } },
    { recovery: { next_action: "future_action" } },
    { reason: "future_reason" },
    { executable: false, recovery: { next_action: "execute" } },
  ]) {
    assert.equal(probeExecutionGuidance({ ...base, ...extra }).action, "stop_and_review_preflight");
  }
  assert.equal(
    probeExecutionGuidance({
      executable: false,
      reason: "realtime_unavailable",
      execution_restrictions: { technical: "blocked" },
    }).action,
    "retry_probe_once_or_select_provider",
  );
  assert.equal(
    probeExecutionGuidance({
      executable: false,
      reason: "realtime_unavailable",
      execution_restrictions: { license: "restricted" },
    }).action,
    "select_allowed_provider",
  );
});
