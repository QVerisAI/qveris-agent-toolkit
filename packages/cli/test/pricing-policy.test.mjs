import assert from "node:assert/strict";
import test from "node:test";

import { classifyPricing, validateQuote } from "../src/utils/pricing-policy.mjs";

test("pricing classification distinguishes absence, explicit free, and any paid risk", () => {
  assert.deepEqual(classifyPricing({}), { status: "absent", requiresQuote: false });
  assert.equal(classifyPricing({ expected_cost: "0 credits per request" }).status, "free");
  assert.equal(classifyPricing({ billing_rule: { price: { amount_credits: 0 } } }).status, "free");

  for (const tool of [
    { expected_cost: "5 credits per successful request" },
    { expected_cost: "variable pricing" },
    { cost_class: "low" },
    { billing_rule: {} },
    { billing_rule: { amount_credits: 0, minimum_charge_credits: 5 } },
    { expected_cost: "0 credits plus variable usage" },
  ]) {
    assert.deepEqual(classifyPricing(tool), { status: "paid_or_uncertain", requiresQuote: true });
  }
});

test("quote validation accepts a structurally valid current estimate", () => {
  const estimate = { estimate_credits: 2, currency: "credits", exact: false };
  assert.deepEqual(validateQuote(estimate), { valid: true, amount: 2, exact: false });
  assert.deepEqual(validateQuote({ estimate_credits: 2, currency: "credits", exact: true }), {
    valid: true,
    amount: 2,
    exact: true,
  });
  for (const quote of [
    undefined,
    { estimate_credits: 2, exact: true },
    { estimate_credits: -1, currency: "credits", exact: true },
    { estimate_credits: 2, currency: "usd", exact: true },
  ]) {
    assert.deepEqual(validateQuote(quote), { valid: false, reason: "malformed" });
  }
});
