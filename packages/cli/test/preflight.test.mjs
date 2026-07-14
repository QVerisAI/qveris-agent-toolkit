import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPreflight, nodeCheck, CLI_CONTRACT_VERSION } from "../src/client/preflight.mjs";
import { CliError } from "../src/errors/handler.mjs";

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test("nodeCheck passes on >=18 and fails older with a hint", () => {
  assert.equal(nodeCheck("v18.0.0").status, "ok");
  assert.equal(nodeCheck("v22.3.1").status, "ok");
  const old = nodeCheck("v16.20.0");
  assert.equal(old.status, "fail");
  assert.ok(old.hint);
});

test("runPreflight: healthy probe reports connectivity, credits, and contract conformance", async () => {
  const probe = async () => ({ search_id: "s1", results: [{ tool_id: "t" }], remaining_credits: 42 });
  const { checks, ok, contractVersion } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  assert.equal(ok, true);
  assert.equal(contractVersion, CLI_CONTRACT_VERSION);
  const c = byName(checks);
  assert.equal(c.node.status, "ok");
  assert.equal(c.api_key.status, "ok");
  assert.equal(c.endpoint.status, "ok");
  assert.equal(c.connectivity.status, "ok");
  assert.equal(c.credits.status, "ok");
  assert.match(c.credits.detail, /42 credits/);
  assert.equal(c.contract.status, "ok");
});

test("runPreflight: zero credits warns (not fails) with a purchase hint", async () => {
  const probe = async () => ({ search_id: "s1", results: [], remaining_credits: 0 });
  const { checks, ok } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  assert.equal(ok, true); // warn does not fail the run
  const credits = byName(checks).credits;
  assert.equal(credits.status, "warn");
  assert.match(credits.hint, /pricing/);
});

test("runPreflight: zero-credits hint follows an explicit endpoint, not the API key", async () => {
  const probe = async () => ({ search_id: "s1", results: [], remaining_credits: 0 });
  const { checks } = await runPreflight({
    apiKeyFlag: "sk-test",
    baseUrlFlag: "https://test.qveris.cn/api/v1",
    probe,
  });

  assert.match(byName(checks).credits.hint, /qveris\.cn\/pricing/);
});

test("runPreflight: invalid base URL fails before probing", async () => {
  let probed = false;
  const { checks, ok } = await runPreflight({
    apiKeyFlag: "sk-test",
    baseUrlFlag: "not-a-url",
    probe: async () => {
      probed = true;
      return {};
    },
  });

  assert.equal(ok, false);
  assert.equal(probed, false);
  assert.equal(byName(checks).endpoint.status, "fail");
});

test("runPreflight: a non-string API key is treated as missing, not crashed", async () => {
  let probed = false;
  const { checks, ok } = await runPreflight({
    apiKeyFlag: 12345, // e.g. a numeric value parsed from config
    probe: async () => {
      probed = true;
      return {};
    },
  });

  assert.equal(ok, false);
  assert.equal(probed, false);
  assert.equal(byName(checks).api_key.status, "fail");
});

test("runPreflight: invalid key becomes an actionable fail from the error knowledge base", async () => {
  const probe = async () => {
    throw new CliError("AUTH_INVALID_KEY", "Authentication failed");
  };
  const { checks, ok } = await runPreflight({ apiKeyFlag: "sk-bad", probe });

  assert.equal(ok, false);
  const fail = checks.find((x) => x.status === "fail");
  assert.equal(fail.name, "api_key_valid");
  assert.ok(fail.hint); // ERROR_CODES.AUTH_INVALID_KEY.hint
});

test("runPreflight: insufficient credits maps to a credits fail with pricing hint", async () => {
  const probe = async () => {
    const err = new CliError("CREDITS_INSUFFICIENT", "Insufficient credits");
    err.hint = "Purchase credits at https://qveris.ai/pricing";
    throw err;
  };
  const { checks, ok } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  assert.equal(ok, false);
  const fail = checks.find((x) => x.status === "fail");
  assert.equal(fail.name, "credits");
  assert.match(fail.hint, /pricing/);
});

test("runPreflight: timeout maps to a connectivity fail with a hint", async () => {
  const probe = async () => {
    throw new CliError("NET_TIMEOUT");
  };
  const { checks, ok } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  assert.equal(ok, false);
  const fail = checks.find((x) => x.status === "fail");
  assert.equal(fail.name, "connectivity");
  assert.ok(fail.hint);
});

test("runPreflight: a non-CliError probe rejection degrades gracefully (no crash, no undefined)", async () => {
  const probe = async () => {
    throw new TypeError("socket hang up");
  };
  const { checks, ok } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  assert.equal(ok, false);
  const fail = checks.find((x) => x.status === "fail");
  assert.equal(fail.name, "connectivity");
  assert.equal(fail.detail, "socket hang up");
  assert.equal(fail.hint, null);
});

test("runPreflight: an unsupported Node version short-circuits before probing", async () => {
  let probed = false;
  const { checks, ok } = await runPreflight({
    apiKeyFlag: "sk-test",
    nodeVersion: "v16.0.0",
    probe: async () => {
      probed = true;
      return { search_id: "s", results: [] };
    },
  });

  assert.equal(ok, false);
  assert.equal(probed, false); // never probes on an unsupported runtime
  assert.equal(byName(checks).node.status, "fail");
});

test("runPreflight: unexpected response shape warns about contract drift", async () => {
  const probe = async () => ({ unexpected: true }); // no search_id / results
  const { checks } = await runPreflight({ apiKeyFlag: "sk-test", probe });

  const contract = byName(checks).contract;
  assert.equal(contract.status, "warn");
  assert.ok(contract.hint);
});

test("runPreflight: missing key fails before probing (no network)", async () => {
  const prev = {
    key: process.env.QVERIS_API_KEY,
    base: process.env.QVERIS_BASE_URL,
    xdg: process.env.XDG_CONFIG_HOME,
  };
  const dir = mkdtempSync(join(tmpdir(), "qveris-preflight-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;

  let probed = false;
  try {
    const { checks, ok } = await runPreflight({
      probe: async () => {
        probed = true;
        return {};
      },
    });

    assert.equal(ok, false);
    assert.equal(probed, false); // never probes without a key
    const keyCheck = byName(checks).api_key;
    assert.equal(keyCheck.status, "fail");
    assert.ok(keyCheck.hint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [
      ["QVERIS_API_KEY", prev.key],
      ["QVERIS_BASE_URL", prev.base],
      ["XDG_CONFIG_HOME", prev.xdg],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
