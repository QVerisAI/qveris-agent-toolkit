import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildNextCommands,
  pickInitTool,
  resolveInitMaxResponseSize,
  runInit,
  shellSingleQuote,
} from "../src/commands/init.mjs";
import { CliError } from "../src/errors/handler.mjs";

function withTempConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), "qveris-cli-init-"));
  const previous = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    QVERIS_API_KEY: process.env.QVERIS_API_KEY,
    QVERIS_BASE_URL: process.env.QVERIS_BASE_URL,
    QVERIS_REGION: process.env.QVERIS_REGION,
    NO_COLOR: process.env.NO_COLOR,
  };
  process.env.XDG_CONFIG_HOME = dir;
  process.env.NO_COLOR = "1";
  delete process.env.QVERIS_API_KEY;
  delete process.env.QVERIS_BASE_URL;
  delete process.env.QVERIS_REGION;

  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    });
}

async function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = function write(chunk, ...args) {
    chunks.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = {
      url: new URL(url),
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return Promise.resolve()
    .then(() => fn(requests))
    .finally(() => {
      globalThis.fetch = original;
    });
}

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("init helpers respect max size and escape single quotes in shell hints", () => {
  assert.equal(resolveInitMaxResponseSize({}), 20480);
  assert.equal(resolveInitMaxResponseSize({ maxSize: "65536" }), 65536);
  assert.throws(
    () => resolveInitMaxResponseSize({ maxSize: "abc" }),
    (err) => err instanceof CliError && err.message.includes("Invalid --max-size")
  );

  const quoted = shellSingleQuote(JSON.stringify({ city: "L'Ondon" }));
  assert.equal(quoted, `'{"city":"L'\\''Ondon"}'`);
  assert.equal(
    buildNextCommands({
      selected: { tool_id: "weather.tool.v1" },
      discoveryId: "search-1",
      parameters: { city: "L'Ondon" },
    }).retry,
    `qveris call weather.tool.v1 --discovery-id search-1 --params ${quoted}`
  );

  assert.equal(
    pickInitTool(
      [
        { tool_id: "icons", params: [{ name: "set", required: true }] },
        { tool_id: "weather", params: [{ name: "city", required: true }] },
      ],
      { parameters: { city: "London" } }
    ).tool_id,
    "weather"
  );
});

test("init dry run records the provided max response size", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "search-1",
          total: 1,
          results: [{ tool_id: "weather.tool.v1", name: "Weather" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({
          results: [
            {
              tool_id: "weather.tool.v1",
              name: "Weather",
              examples: { sample_parameters: { city: "London" } },
            },
          ],
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      const stdout = await captureStdout(() => runInit(null, {
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        json: true,
        dryRun: true,
        maxSize: "65536",
      }));
      const payload = JSON.parse(stdout);
      const callStep = payload.steps.find((step) => step.name === "call");
      assert.equal(callStep.max_response_size, 65536);
    });
  });
});

test("init selects a candidate whose required params match provided params", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "search-1",
          total: 2,
          results: [
            { tool_id: "weather.icons.v1", name: "Icons" },
            { tool_id: "weather.city.v1", name: "City Weather" },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        assert.deepEqual(request.body.tool_ids, ["weather.icons.v1", "weather.city.v1"]);
        return response({
          results: [
            {
              tool_id: "weather.icons.v1",
              name: "Icons",
              params: [
                { name: "set", required: true },
                { name: "timeOfDay", required: true },
              ],
              examples: { sample_parameters: { set: "land", timeOfDay: "day" } },
            },
            {
              tool_id: "weather.city.v1",
              name: "City Weather",
              params: [{ name: "city", required: true }],
              examples: { sample_parameters: { city: "London" } },
            },
          ],
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      const stdout = await captureStdout(() => runInit(null, {
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        json: true,
        dryRun: true,
        params: '{"city":"London"}',
      }));
      const payload = JSON.parse(stdout);
      const inspectStep = payload.steps.find((step) => step.name === "inspect");
      const callStep = payload.steps.find((step) => step.name === "call");

      assert.equal(payload.selected_tool.tool_id, "weather.city.v1");
      assert.equal(inspectStep.selected_reason, "params_match");
      assert.equal(callStep.tool_id, "weather.city.v1");
      assert.match(payload.next_commands.retry, /qveris call weather\.city\.v1/);
    });
  });
});

test("init human summary prints selected tool after inspection", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "search-1",
          total: 1,
          results: [{ tool_id: "weather.tool.v1", name: "Weather" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({
          results: [
            {
              tool_id: "weather.tool.v1",
              name: "Weather",
              params: [{ name: "city", required: true }],
              examples: { sample_parameters: { city: "London" } },
            },
          ],
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      const stdout = await captureStdout(() => runInit(null, {
        apiKey: "sk-test",
        baseUrl: "https://unit.test/api/v1",
        dryRun: true,
      }));

      assert.match(stdout, /search_id\s+search-1/);
      assert.match(stdout, /inspect[\s\S]*selected\s+weather\.tool\.v1/);
    });
  });
});

test("init call uses max size and failure hint remains copyable with single quotes", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "search-1",
          total: 1,
          results: [{ tool_id: "weather.tool.v1", name: "Weather" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({
          results: [
            {
              tool_id: "weather.tool.v1",
              name: "Weather",
              examples: { sample_parameters: { city: "L'Ondon" } },
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        assert.equal(request.body.max_response_size, 65536);
        return response({
          execution_id: "exec-1",
          success: false,
          error_message: "bad params",
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      await assert.rejects(
        () => runInit(null, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          json: true,
          maxSize: "65536",
        }),
        (err) => (
          err instanceof CliError &&
          err.code === "TOOL_CALL_FAILED" &&
          err.hint.includes(`--params '{"city":"L'\\''Ondon"}'`)
        )
      );
    });
  });
});

test("init provider failures keep provider recovery hint", async () => {
  await withTempConfig(async () => {
    await withMockFetch((request) => {
      if (request.url.pathname.endsWith("/search")) {
        return response({
          search_id: "search-1",
          total: 1,
          results: [{ tool_id: "weather.tool.v1", name: "Weather" }],
        });
      }
      if (request.url.pathname.endsWith("/tools/by-ids")) {
        return response({
          results: [
            {
              tool_id: "weather.tool.v1",
              name: "Weather",
              examples: { sample_parameters: { city: "London" } },
            },
          ],
        });
      }
      if (request.url.pathname.endsWith("/tools/execute")) {
        return response({
          execution_id: "exec-1",
          success: false,
          error_message: "upstream provider temporarily unavailable",
        });
      }
      throw new Error(`unexpected path ${request.url.pathname}`);
    }, async () => {
      await assert.rejects(
        () => runInit(null, {
          apiKey: "sk-test",
          baseUrl: "https://unit.test/api/v1",
          json: true,
        }),
        (err) => (
          err instanceof CliError &&
          err.code === "PROVIDER_FAILURE" &&
          err.hint.includes("Try another discovered capability") &&
          !err.hint.includes("--params")
        )
      );
    });
  });
});
