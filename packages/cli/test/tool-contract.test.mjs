import assert from "node:assert/strict";
import test from "node:test";

import { analyzeParameterSchema, validateParameters } from "../src/utils/tool-contract.mjs";

test("parameter contracts implement JSON primitive semantics", () => {
  const definitions = [
    { name: "count", type: "integer", required: true },
    { name: "ratio", type: "number", required: true },
    { name: "options", type: "object", required: true },
    { name: "items", type: "array", required: true },
    { name: "empty", type: "null", required: false },
  ];
  const analysis = analyzeParameterSchema(definitions);
  assert.equal(analysis.complete, true);
  assert.deepEqual(
    validateParameters(analysis.definitions, {
      count: 2,
      ratio: 2.5,
      options: {},
      items: [],
      empty: null,
    }),
    { valid: true, missingFields: [], unknown: [], invalid: [] },
  );
  assert.deepEqual(validateParameters(analysis.definitions, { count: 2.5, ratio: 2, options: [], items: {} }), {
    valid: false,
    missingFields: [],
    unknown: [],
    invalid: ["count", "options", "items"],
  });
});

test("parameter contracts defer ambiguous schemas and reject unknown request fields", () => {
  assert.equal(analyzeParameterSchema(undefined).complete, false);
  assert.equal(
    analyzeParameterSchema([
      { name: "value", type: "string", required: false },
      { name: "value", type: "string", required: false },
    ]).complete,
    false,
  );
  assert.equal(analyzeParameterSchema([{ name: "value", type: "future-type", required: false }]).complete, false);
  assert.deepEqual(validateParameters([{ name: "value", type: "string", required: true }], { extra: "x" }), {
    valid: false,
    missingFields: ["value"],
    unknown: ["extra"],
    invalid: [],
  });
});
