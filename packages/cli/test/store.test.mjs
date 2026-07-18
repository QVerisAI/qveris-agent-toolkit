import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { getConfigPath, readConfig, setConfigValue } from "../src/config/store.mjs";

function withTempConfig(callback) {
  const previous = process.env.XDG_CONFIG_HOME;
  const directory = join(tmpdir(), `qveris-store-${process.pid}-${Date.now()}`);
  process.env.XDG_CONFIG_HOME = directory;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("missing config is empty, but corrupt config is never overwritten", () => {
  withTempConfig(() => {
    assert.deepEqual(readConfig(), {});
    const path = getConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{broken", "utf8");
    assert.throws(() => readConfig(), /contains invalid JSON/);
    assert.throws(() => setConfigValue("api_key", "must-not-be-written"), /contains invalid JSON/);
    assert.equal(readFileSync(path, "utf8"), "{broken");
  });
});

test("config root must be a JSON object", () => {
  withTempConfig(() => {
    const path = getConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "[]", "utf8");
    assert.throws(() => readConfig(), /must contain a JSON object/);
  });
});
