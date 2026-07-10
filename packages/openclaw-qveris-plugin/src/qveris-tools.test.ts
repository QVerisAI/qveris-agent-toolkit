import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import plugin from "../index.js";
import { inferCsvAnalysis, inferJsonAnalysis, inferTextAnalysis } from "./qveris-materialization.js";
import { createQverisTools } from "./qveris-tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePluginConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    apiKey: "qv_test_key",
    ...overrides,
  };
}

function fakeApi(pluginConfig?: Record<string, unknown>): OpenClawPluginApi {
  return {
    pluginConfig: pluginConfig ?? makePluginConfig(),
    config: {},
  } as unknown as OpenClawPluginApi;
}

function fakeCtx(overrides?: Record<string, unknown>) {
  return {
    config: {},
    workspaceDir: undefined,
    sessionKey: "test-session-1",
    ...overrides,
  };
}

function mockFetchJson(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  });
}

/** Extract the JSON payload from an AgentToolResult */
function parseToolResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && "details" in result) {
    return (result as { details: Record<string, unknown> }).details;
  }
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: Array<{ text: string }> }).content;
    return JSON.parse(content[0].text) as Record<string, unknown>;
  }
  return JSON.parse(String(result)) as Record<string, unknown>;
}

function parseRequestBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") return JSON.parse(body) as Record<string, unknown>;
  if (body == null) return {};
  throw new Error(`Unsupported mocked request body type: ${typeof body}`);
}

const SAMPLE_DISCOVER_RESPONSE = {
  query: "weather forecast API",
  total: 1,
  search_id: "search-abc",
  elapsed_time_ms: 42,
  results: [
    {
      tool_id: "openweathermap.weather.execute.v1",
      name: "OpenWeatherMap",
      description: "Weather forecast API",
      provider_description: "Weather data provider",
      params: [{ name: "city", type: "string", required: true, description: { en: "City name" } }],
      examples: { sample_parameters: { city: "London" } },
      stats: { success_rate: 0.95, avg_execution_time_ms: 800 },
      why_recommended: "Matched both semantic and keyword relevance signals.",
      expected_cost: "3.0",
    },
  ],
};

const SAMPLE_INVOKE_RESPONSE = {
  execution_id: "exec-123",
  result: { data: { temp: 20, condition: "sunny" } },
  success: true,
  error_message: null,
  elapsed_time_ms: 300,
  cost: 0.01,
};

const SAMPLE_INSPECT_RESPONSE = {
  tools: [
    {
      tool_id: "openweathermap.weather.execute.v1",
      name: "OpenWeatherMap",
      description: "Weather forecast API",
      params: [{ name: "city", type: "string", required: true, description: { en: "City name" } }],
      examples: { sample_parameters: { city: "London" } },
      stats: { success_rate: 0.95, avg_execution_time_ms: 800 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin registration", () => {
  it("registers tool factory with correct names", () => {
    const registrations: {
      factories: unknown[];
      opts: unknown[];
    } = { factories: [], opts: [] };

    const mockApi = {
      registerTool(factory: unknown, opts: unknown) {
        registrations.factories.push(factory);
        registrations.opts.push(opts);
      },
      pluginConfig: makePluginConfig(),
      config: {},
    };

    plugin.register(mockApi as never);

    expect(plugin.id).toBe("qveris");
    expect(plugin.name).toBe("QVeris Plugin");
    expect(registrations.factories).toHaveLength(1);
    expect(typeof registrations.factories[0]).toBe("function");
    expect(registrations.opts[0]).toEqual({
      names: ["qveris_discover", "qveris_call", "qveris_inspect"],
    });
  });
});

// ---------------------------------------------------------------------------
// createQverisTools — factory behavior
// ---------------------------------------------------------------------------

describe("createQverisTools", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates three tools when API key is configured", () => {
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    expect(tools).toHaveLength(3);
    const names = tools!.map((t) => t.name);
    expect(names).toContain("qveris_discover");
    expect(names).toContain("qveris_call");
    expect(names).toContain("qveris_inspect");
  });

  it("qveris_discover description includes negative boundaries", () => {
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover");
    expect(discover?.description).toContain("NOT for");
    expect(discover?.description).toContain("local file operations");
    expect(discover?.description).toContain("documentation");
  });

  it("qveris_call schema has tool_id and params_to_tool but not search_id", () => {
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const callTool = tools!.find((t) => t.name === "qveris_call");
    const schema = callTool?.parameters as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties?.tool_id).toBeDefined();
    expect(schema?.properties?.params_to_tool).toBeDefined();
    expect(schema?.properties?.search_id).toBeUndefined();
    expect(schema?.properties?.discovery_id).toBeUndefined();
  });

  it("qveris_discover query schema includes bilingual guidance", () => {
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover");
    const schema = discover?.parameters as { properties?: Record<string, unknown> };
    const queryDescription = (schema.properties?.query as Record<string, unknown>)?.description ?? "";
    expect(String(queryDescription)).toContain("腾讯最新股价");
    expect(String(queryDescription)).toContain("stock quote real-time API");
  });

  it("qveris_inspect returns tool details", async () => {
    globalThis.fetch = mockFetchJson(SAMPLE_INSPECT_RESPONSE);
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const inspect = tools!.find((t) => t.name === "qveris_inspect")!;

    const result = await inspect.execute("call-1", { tool_ids: "openweathermap.weather.execute.v1" });
    const parsed = parseToolResult(result);
    expect(parsed.tools_found).toBe(1);
    const toolsList = parsed.tools as Array<Record<string, unknown>>;
    expect(toolsList[0].tool_id).toBe("openweathermap.weather.execute.v1");
  });

  it("qveris_inspect returns error for empty tool_ids", async () => {
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const inspect = tools!.find((t) => t.name === "qveris_inspect")!;

    const result = await inspect.execute("call-1", { tool_ids: " , , " });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error_type).toBe("json_parse_error");
    expect(String(parsed.note)).toContain("Stay inside the QVeris tool workflow");
  });

  it("qveris_call proceeds with null search_id when tool not discovered", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ execution_id: "exec-1", success: true, result: { data: "ok" } }),
      text: () => Promise.resolve(""),
      headers: new Headers(),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    await callTool.execute("call-1", {
      tool_id: "unknown-tool-xyz",
      params_to_tool: '{"city": "London"}',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/tools/execute");
    const body = JSON.parse(init.body);
    expect(body.search_id).toBeNull();
  });

  it("qveris_call auto-resolves search_id from discover tracker", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_DISCOVER_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        const body = parseRequestBody(init?.body);
        expect(body.search_id).toBe("search-abc");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_INVOKE_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;

    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover")!;
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    await discover.execute("d1", { query: "weather forecast API" });
    const result = await callTool.execute("c1", {
      tool_id: "openweathermap.weather.execute.v1",
      params_to_tool: '{"city": "London"}',
    });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.execution_id).toBe("exec-123");
  });

  it("qveris_call returns recovery_step on body-level failure", async () => {
    const failResponse = {
      execution_id: "exec-fail",
      result: null,
      success: false,
      error_message: "Invalid parameter: city not found",
      elapsed_time_ms: 100,
      cost: 0,
    };
    const discoverResponse = {
      query: "tool x API",
      total: 1,
      search_id: "s1",
      results: [{ tool_id: "tool-x", name: "ToolX", description: "test" }],
    };
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(discoverResponse),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(failResponse),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      });
    });

    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover")!;
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    await discover.execute("d1", { query: "tool x API" });
    const result1 = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"a"}' });
    const parsed1 = parseToolResult(result1);
    expect(parsed1.success).toBe(false);
    expect(parsed1.recovery_step).toBe("fix_params");
    expect(parsed1.attempt_number).toBe(1);

    const result2 = await callTool.execute("c2", { tool_id: "tool-x", params_to_tool: '{"q":"b"}' });
    const parsed2 = parseToolResult(result2);
    expect(parsed2.recovery_step).toBe("simplify");
    expect(parsed2.attempt_number).toBe(2);
  });

  it("rolodex records successful invocations and annotates discover results", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_DISCOVER_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_INVOKE_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });

    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover")!;
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const r1 = await discover.execute("s1", { query: "weather forecast API" });
    const p1 = parseToolResult(r1);
    expect(p1.session_known_tools).toBeUndefined();
    const results1 = p1.results as Array<Record<string, unknown>>;
    expect(results1[0].previously_used).toBeUndefined();

    await callTool.execute("e1", {
      tool_id: "openweathermap.weather.execute.v1",
      params_to_tool: '{"city": "London"}',
    });

    const r2 = await discover.execute("s2", { query: "weather data API", limit: 5 });
    const p2 = parseToolResult(r2);
    const knownTools = p2.session_known_tools as Array<Record<string, unknown>>;
    expect(knownTools).toBeDefined();
    expect(knownTools).toHaveLength(1);
    expect(knownTools[0].tool_id).toBe("openweathermap.weather.execute.v1");
    expect(knownTools[0].uses).toBe(1);
    expect(knownTools[0].discovery_id).toBeUndefined();

    const results2 = p2.results as Array<Record<string, unknown>>;
    expect(results2[0].previously_used).toBe(true);
    expect(results2[0].session_uses).toBe(1);
    expect(results2[0].discovery_id).toBeUndefined();
  });

  it("qveris_discover projects why_recommended and expected_cost, omitting them when absent", async () => {
    const response = {
      query: "weather forecast API",
      total: 2,
      search_id: "search-abc",
      results: [
        SAMPLE_DISCOVER_RESPONSE.results[0],
        { tool_id: "bare.tool.v1", name: "Bare Tool", description: "No extras" },
      ],
    };
    globalThis.fetch = mockFetchJson(response);
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover")!;

    const parsed = parseToolResult(await discover.execute("d1", { query: "weather forecast API" }));
    const results = parsed.results as Array<Record<string, unknown>>;

    expect(results[0].why_recommended).toBe("Matched both semantic and keyword relevance signals.");
    expect(results[0].expected_cost).toBe("3.0");
    expect(results[1].why_recommended).toBeUndefined();
    expect(results[1].expected_cost).toBeUndefined();
  });

  it("qveris_call parses invalid JSON in params_to_tool gracefully", async () => {
    globalThis.fetch = mockFetchJson(SAMPLE_DISCOVER_RESPONSE);
    const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
    const discover = tools!.find((t) => t.name === "qveris_discover")!;
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    await discover.execute("d1", { query: "weather forecast API" });
    const result = await callTool.execute("c1", {
      tool_id: "openweathermap.weather.execute.v1",
      params_to_tool: "not-valid-json",
    });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error_type).toBe("json_parse_error");
  });

  it.each(["null", "123", '"city"', "[1,2]"])(
    "qveris_call rejects non-object params_to_tool JSON: %s",
    async (paramsToTool) => {
      globalThis.fetch = mockFetchJson(SAMPLE_DISCOVER_RESPONSE);
      const tools = createQverisTools({ api: fakeApi(), ctx: fakeCtx() });
      const discover = tools!.find((t) => t.name === "qveris_discover")!;
      const callTool = tools!.find((t) => t.name === "qveris_call")!;

      await discover.execute("d1", { query: "weather forecast API" });
      const result = await callTool.execute("c1", {
        tool_id: "openweathermap.weather.execute.v1",
        params_to_tool: paramsToTool,
      });

      const parsed = parseToolResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error_type).toBe("json_parse_error");
      expect(parsed.detail).toContain("JSON object");
    },
  );

  it("session state is isolated per factory call — undiscovered call uses null search_id", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_DISCOVER_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SAMPLE_INVOKE_RESPONSE),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), headers: new Headers() });
    });
    globalThis.fetch = fetchMock;
    const tools1 = createQverisTools({ api: fakeApi(), ctx: fakeCtx({ sessionKey: "s1" }) });
    const tools2 = createQverisTools({ api: fakeApi(), ctx: fakeCtx({ sessionKey: "s2" }) });

    const discover1 = tools1!.find((t) => t.name === "qveris_discover")!;
    const callTool2 = tools2!.find((t) => t.name === "qveris_call")!;

    await discover1.execute("d1", { query: "weather forecast API" });

    // tools2 should not see tools1's discovery — call proceeds with null search_id
    await callTool2.execute("c1", {
      tool_id: "openweathermap.weather.execute.v1",
      params_to_tool: '{"city": "London"}',
    });
    const executeCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/tools/execute"));
    expect(executeCall).toBeDefined();
    const body = JSON.parse(executeCall![1].body);
    expect(body.search_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferJsonAnalysis
// ---------------------------------------------------------------------------

describe("inferJsonAnalysis", () => {
  it("infers JSON array schema from first record", () => {
    const data = JSON.stringify([
      { user_id: "abc", nickname: "test", fans_count: 123, tags: ["a", "b"] },
      { user_id: "def", nickname: "test2", fans_count: 456, tags: ["c"] },
    ]);
    const result = inferJsonAnalysis(data, 800);
    expect(result.root_type).toBe("array");
    expect(result.record_count).toBe(2);
    expect(result.fields).toBeDefined();
    expect(result.fields!.user_id).toBe("string");
    expect(result.fields!.fans_count).toBe("number");
    expect(result.fields!.tags).toBe("string[]");
    expect(result.preview_records).toBe(2);
    expect(result.preview).toBeDefined();
  });

  it("infers JSON object schema", () => {
    const data = JSON.stringify({ items: [1, 2, 3], total: 3, name: "test" });
    const result = inferJsonAnalysis(data, 800);
    expect(result.root_type).toBe("object");
    expect(result.fields).toBeDefined();
    expect(result.fields!.items).toBe("array[3]");
    expect(result.fields!.total).toBe("number");
    expect(result.fields!.name).toBe("string");
  });

  it("returns empty analysis for invalid JSON", () => {
    const result = inferJsonAnalysis("not json", 800);
    expect(result.root_type).toBeUndefined();
  });
});

describe("inferCsvAnalysis", () => {
  it("counts non-empty rows and previews only the first rows", () => {
    const rows = ["name,value", ...Array.from({ length: 1000 }, (_, i) => `row-${i},${i}`)];
    const result = inferCsvAnalysis(rows.join("\n"), 800);

    expect(result.line_count).toBe(1001);
    expect(result.column_names).toEqual(["name", "value"]);
    expect(result.preview).toContain("row-0,0");
    expect(result.preview).toContain("row-3,3");
    expect(result.preview).not.toContain("row-4,4");
    expect(result.preview).not.toContain("row-999,999");
  });
});

describe("inferTextAnalysis", () => {
  it("counts lines without splitting the whole text into an array", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line-${i}`).join("\n");
    const result = inferTextAnalysis(text, 20);

    expect(result.line_count).toBe(1000);
    expect(result.preview).toBe("line-0\nline-1\nline-2...");
  });
});

// ---------------------------------------------------------------------------
// Full-content materialization
// ---------------------------------------------------------------------------

describe("qveris_call materialization", () => {
  let originalFetch: typeof globalThis.fetch;
  let tmpDir: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "qveris-materialize-test-"));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const TRUNCATED_CALL_RESPONSE = {
    execution_id: "exec-trunc-1",
    result: {
      status_code: 200,
      message: "Result content is too long (132707 bytes)",
      truncated_content: '[{"user_id":"abc","nickname":"partial..."}]',
      full_content_file_url: "https://oss.qveris.ai/full-content/exec-trunc-1.json",
      content_schema: { type: "array" },
    },
    success: true,
    error_message: null,
    elapsed_time_ms: 500,
    cost: 0.05,
  };

  const FULL_CONTENT_JSON = JSON.stringify([
    { user_id: "abc", nickname: "KOL_A", fans_count: 52000, tags: ["beauty"] },
    { user_id: "def", nickname: "KOL_B", fans_count: 31000, tags: ["fashion"] },
  ]);

  function makeDiscoverResponse(toolId: string, searchId = "search-mat") {
    return {
      query: "materialize test",
      total: 1,
      search_id: searchId,
      results: [{ tool_id: toolId, name: toolId, description: "test tool" }],
    };
  }

  async function registerToolViaDiscover(
    tools: Array<{ name: string; execute: (id: string, args: Record<string, unknown>) => Promise<unknown> }>,
    toolId: string,
  ) {
    const discover = tools.find((t) => t.name === "qveris_discover")!;
    await discover.execute("pre-discover", { query: `find ${toolId}` });
  }

  /** Build a fake Response whose body can be read via arrayBuffer() */
  function fakeTextResponse(text: string, contentType: string) {
    const encoded = new TextEncoder().encode(text);
    return {
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(encoded.buffer.slice(0) as ArrayBuffer),
      text: () => Promise.resolve(text),
      headers: new Headers({ "content-type": contentType }),
    };
  }

  function makeMaterializeFetchMock(opts?: {
    toolId?: string;
    callResponse?: typeof TRUNCATED_CALL_RESPONSE;
    ossHandler?: (url: string) => Promise<unknown>;
  }) {
    const toolId = opts?.toolId ?? "test-tool";
    const callResponse = opts?.callResponse ?? TRUNCATED_CALL_RESPONSE;
    return vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse(toolId)),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(callResponse),
          text: () => Promise.resolve(JSON.stringify(callResponse)),
          headers: new Headers(),
        });
      }
      if (opts?.ossHandler && typeof url === "string" && url.includes("oss.qveris.ai")) {
        return opts.ossHandler(url);
      }
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        return Promise.resolve(fakeTextResponse(FULL_CONTENT_JSON, "application/json"));
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
  }

  it("materializes full content when full_content_file_url is present", async () => {
    globalThis.fetch = makeMaterializeFetchMock({ toolId: "kol-search-tool" });
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "kol-search-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", {
      tool_id: "kol-search-tool",
      params_to_tool: '{"keyword": "beauty"}',
    });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.materialized_content).toBeDefined();
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("ready");
    expect(mc.content_category).toBe("json");
    expect(typeof mc.path).toBe("string");
    expect(mc.consumption_contract).toContain("read or exec");

    const filePath = path.join(tmpDir, mc.path as string);
    const content = await fsp.readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toHaveLength(2);
  });

  it("strips truncated transport fields on successful materialization", async () => {
    globalThis.fetch = makeMaterializeFetchMock({ toolId: "kol-search-tool" });
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "kol-search-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", {
      tool_id: "kol-search-tool",
      params_to_tool: '{"keyword": "beauty"}',
    });
    const parsed = parseToolResult(result);
    const resultObj = parsed.result as Record<string, unknown>;
    expect(resultObj.truncated_content).toBeUndefined();
    expect(resultObj.full_content_file_url).toBeUndefined();
    expect(resultObj.status_code).toBe(200);
    expect(resultObj.message).toBeDefined();
    expect(resultObj.content_schema).toBeDefined();
  });

  it("degrades gracefully when full content download times out", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("tool-x")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(TRUNCATED_CALL_RESPONSE),
          text: () => Promise.resolve(JSON.stringify(TRUNCATED_CALL_RESPONSE)),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "tool-x");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.truncated).toBe(true);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("failed");
    expect(mc.reason).toBe("download_timeout");
  });

  it("blocks download from non-whitelisted domain", async () => {
    const blockedResponse = {
      ...TRUNCATED_CALL_RESPONSE,
      result: {
        ...TRUNCATED_CALL_RESPONSE.result,
        full_content_file_url: "https://evil-bucket.s3.amazonaws.com/data.json",
      },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("tool-x")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(blockedResponse),
        text: () => Promise.resolve(JSON.stringify(blockedResponse)),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "tool-x");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("failed");
    expect(mc.reason).toBe("download_error");
    expect(String(mc.detail)).toContain("not in the allowed list");
  });

  it("blocks download from non-HTTPS URL", async () => {
    const httpResponse = {
      ...TRUNCATED_CALL_RESPONSE,
      result: { ...TRUNCATED_CALL_RESPONSE.result, full_content_file_url: "http://insecure.example.com/data.json" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("tool-x")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(httpResponse),
        text: () => Promise.resolve(JSON.stringify(httpResponse)),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "tool-x");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("failed");
    expect(mc.reason).toBe("download_error");
    expect(String(mc.detail)).toContain("HTTPS");
  });

  it("skips materialization when autoMaterializeFullContent is false", async () => {
    globalThis.fetch = makeMaterializeFetchMock({ toolId: "tool-x" });
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: false }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "tool-x");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.materialized_content).toBeUndefined();
    expect(parsed.truncation_hint).toContain("full_content_file_url");
  });

  it("skips materialization when no workspaceDir", async () => {
    globalThis.fetch = makeMaterializeFetchMock({ toolId: "tool-x" });
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: undefined }),
    });
    await registerToolViaDiscover(tools!, "tool-x");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.materialized_content).toBeUndefined();
  });

  it("materializes binary content (image/png)", async () => {
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
    const binaryResponse = {
      ...TRUNCATED_CALL_RESPONSE,
      result: { ...TRUNCATED_CALL_RESPONSE.result, full_content_file_url: "https://oss.qveris.ai/images/chart.png" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("img-tool")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("/tools/execute"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(binaryResponse),
          text: () => Promise.resolve(JSON.stringify(binaryResponse)),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(pngSignature.buffer.slice(0)),
          headers: new Headers({ "content-type": "image/png" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), headers: new Headers() });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "img-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "img-tool", params_to_tool: '{"q":"chart"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("ready");
    expect(mc.content_category).toBe("image");
    expect(mc.mime_type).toBe("image/png");
    expect(String(mc.path)).toContain(".png");
    expect(mc.consumption_contract).toContain("Binary file saved");
    expect(mc.analysis).toBeUndefined();
    expect(mc.preview).toBeUndefined();

    const written = await fsp.readFile(path.join(tmpDir, mc.path as string));
    expect(new Uint8Array(written)).toEqual(pngSignature);
  });

  it("rejects download when content is truncated by byte limit", async () => {
    const largeContent = "x".repeat(200);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("big-tool")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("/tools/execute"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(TRUNCATED_CALL_RESPONSE),
          text: () => Promise.resolve(JSON.stringify(TRUNCATED_CALL_RESPONSE)),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        const encoder = new TextEncoder();
        const fullBytes = encoder.encode(largeContent);
        return Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(fullBytes);
              controller.close();
            },
          }),
          headers: new Headers({ "content-type": "application/json" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), headers: new Headers() });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true, fullContentMaxBytes: 50 }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "big-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "big-tool", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("failed");
    expect(mc.reason).toBe("download_truncated");
    expect(String(mc.detail)).toContain("truncated");
  });

  it("reclassifies application/octet-stream as JSON when content looks like JSON", async () => {
    const octetStreamResponse = {
      ...TRUNCATED_CALL_RESPONSE,
      result: { ...TRUNCATED_CALL_RESPONSE.result, full_content_file_url: "https://oss.qveris.ai/data/result.bin" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("generic-tool")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("/tools/execute"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(octetStreamResponse),
          text: () => Promise.resolve(JSON.stringify(octetStreamResponse)),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        const encoded = new TextEncoder().encode(FULL_CONTENT_JSON);
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(encoded.buffer.slice(0) as ArrayBuffer),
          text: () => Promise.resolve(FULL_CONTENT_JSON),
          headers: new Headers({ "content-type": "application/octet-stream" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "generic-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "generic-tool", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("ready");
    expect(mc.content_category).toBe("json");
    expect(mc.mime_type).toBe("application/json");
    expect(mc.analysis).toBeDefined();
    expect(String(mc.path)).toContain(".json");
  });

  it("handles CSV content", async () => {
    const csvContent = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,SF";
    const csvResponse = {
      ...TRUNCATED_CALL_RESPONSE,
      result: { ...TRUNCATED_CALL_RESPONSE.result, full_content_file_url: "https://oss.qveris.ai/data.csv" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/search"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeDiscoverResponse("csv-tool")),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("/tools/execute"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(csvResponse),
          text: () => Promise.resolve(JSON.stringify(csvResponse)),
          headers: new Headers(),
        });
      if (typeof url === "string" && url.includes("oss.qveris.ai")) {
        const encoded = new TextEncoder().encode(csvContent);
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(encoded.buffer.slice(0) as ArrayBuffer),
          text: () => Promise.resolve(csvContent),
          headers: new Headers({ "content-type": "text/csv" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;
    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });
    await registerToolViaDiscover(tools!, "csv-tool");
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    const result = await callTool.execute("c1", { tool_id: "csv-tool", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("ready");
    expect(mc.content_category).toBe("csv");
    const analysis = (mc as { analysis?: Record<string, unknown> }).analysis;
    expect(analysis?.line_count).toBe(4);
    expect(analysis?.column_names).toEqual(["name", "age", "city"]);
  });

  it("cn region routes API calls to qveris.cn and accepts oss.qveris.cn materialization URL", async () => {
    const CN_OSS_URL = "https://oss.qveris.cn/full-content/exec-cn-1.json";
    const cnInvokeResponse = {
      execution_id: "exec-cn-1",
      result: {
        status_code: 200,
        message: "truncated",
        truncated_content: '[{"id":1}]',
        full_content_file_url: CN_OSS_URL,
      },
      success: true,
      error_message: null,
      elapsed_time_ms: 200,
      cost: 0.01,
    };
    const cnDiscoverResponse = {
      query: "cn tool API",
      total: 1,
      search_id: "cn-search-1",
      results: [{ tool_id: "cn-tool-x", name: "CnToolX", description: "CN tool" }],
    };
    const cnFullContent = JSON.stringify([{ id: 1, name: "cn result" }]);

    const observedApiUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      observedApiUrls.push(url);
      if (typeof url === "string" && url.includes("/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(cnDiscoverResponse),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("/tools/execute")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(cnInvokeResponse),
          text: () => Promise.resolve(JSON.stringify(cnInvokeResponse)),
          headers: new Headers(),
        });
      }
      if (typeof url === "string" && url.includes("oss.qveris.cn")) {
        const encoded = new TextEncoder().encode(cnFullContent);
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(encoded.buffer.slice(0) as ArrayBuffer),
          text: () => Promise.resolve(cnFullContent),
          headers: new Headers({ "content-type": "application/json" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
    });
    globalThis.fetch = fetchMock;

    const tools = createQverisTools({
      api: fakeApi({ apiKey: "qv_test_key", region: "cn", autoMaterializeFullContent: true }),
      ctx: fakeCtx({ workspaceDir: tmpDir }),
    });

    const discover = tools!.find((t) => t.name === "qveris_discover")!;
    const callTool = tools!.find((t) => t.name === "qveris_call")!;

    await discover.execute("d1", { query: "cn tool API" });
    const result = await callTool.execute("c1", { tool_id: "cn-tool-x", params_to_tool: '{"q":"test"}' });
    const parsed = parseToolResult(result);

    // All API calls must go to qveris.cn, not qveris.ai
    const apiCalls = observedApiUrls.filter((u) => u.includes("/search") || u.includes("/tools/execute"));
    for (const apiUrl of apiCalls) {
      expect(apiUrl).toContain("qveris.cn");
      expect(apiUrl).not.toContain("qveris.ai");
    }

    // Materialization from oss.qveris.cn must succeed
    expect(parsed.success).toBe(true);
    const mc = parsed.materialized_content as Record<string, unknown>;
    expect(mc.status).toBe("ready");
    expect(mc.content_category).toBe("json");
  });
});
