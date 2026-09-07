import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeCreditBalance, normalizeCreditBalanceResponse } from "../src/client/credit-balance.mjs";

const contract = JSON.parse(
  readFileSync(new URL("../../../test-fixtures/credit-balance-contract.json", import.meta.url), "utf8"),
);

for (const fixture of contract.cases) {
  test(`credit balance contract: ${fixture.name}`, () => {
    assert.deepEqual(normalizeCreditBalance(fixture.input), {
      value: fixture.expected,
      invalid: fixture.invalid,
    });
  });
}

for (const input of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  test(`credit balance contract rejects non-finite ${String(input)}`, () => {
    assert.deepEqual(normalizeCreditBalance(input), { value: null, invalid: true });
  });
}

test("normalizes raw and enveloped balances without traversing capability results", () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  assert.deepEqual(normalizeCreditBalanceResponse({ remaining_credits: "12.5" }, warn), {
    remaining_credits: 12.5,
  });
  assert.deepEqual(normalizeCreditBalanceResponse({ status: "success", data: { remaining_credits: "0" } }, warn), {
    status: "success",
    data: { remaining_credits: 0 },
  });
  const capabilityResult = { result: { data: { remaining_credits: "provider-defined" } } };
  assert.equal(normalizeCreditBalanceResponse(capabilityResult, warn), capabilityResult);
  assert.deepEqual(warnings, []);
});

test("invalid balances become unavailable and emit one diagnostic", () => {
  const warnings = [];
  assert.deepEqual(
    normalizeCreditBalanceResponse({ remaining_credits: "unavailable" }, (message) => warnings.push(message)),
    { remaining_credits: null },
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /treating the balance as unavailable/);
});
