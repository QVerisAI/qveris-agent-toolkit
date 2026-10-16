import assert from "node:assert/strict";
import test from "node:test";
import { parseNpmPackResult } from "./npm-pack-result.mjs";

const name = "@qverisai/qveris";
const pack = { name, filename: "qverisai-qveris.tgz", files: [{ path: "dist/index.js" }] };

test("reads npm 11 arrays and npm 12 package-keyed objects", () => {
  for (const result of [[pack], { [name]: pack }]) {
    assert.deepEqual(parseNpmPackResult(JSON.stringify(result), name), pack);
  }
});

test("rejects malformed, empty, multiple, or unexpected package results", () => {
  for (const result of [null, [], {}, [pack, pack], { [name]: pack, other: pack }, [{ ...pack, name: "other" }]]) {
    assert.throws(() => parseNpmPackResult(JSON.stringify(result), name), /exactly one result/);
  }
  assert.throws(() => parseNpmPackResult("invalid JSON", name), SyntaxError);
});
