import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  DEFAULT_QVERIS_BASE_URL,
  resolveQverisApiKey,
  resolveQverisBaseUrl,
  resolveDiscoverTimeoutSeconds,
  resolveCallTimeoutSeconds,
  resolveFullContentAllowedDomains,
} from "./config.js";
import { createQverisTools } from "./qveris-tools.js";

function fakeApi(pluginConfig?: Record<string, unknown>): OpenClawPluginApi {
  return {
    pluginConfig: pluginConfig ?? {},
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

describe("config resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves API key from plugin config", () => {
    expect(resolveQverisApiKey({ apiKey: "from-config" })).toBe("from-config");
  });

  it("falls back to QVERIS_API_KEY env", () => {
    vi.stubEnv("QVERIS_API_KEY", "env-key");
    expect(resolveQverisApiKey(undefined)).toBe("env-key");
  });

  it("prefers plugin config over env var", () => {
    vi.stubEnv("QVERIS_API_KEY", "env-key");
    expect(resolveQverisApiKey({ apiKey: "config-key" })).toBe("config-key");
  });

  it("returns undefined when no key anywhere", () => {
    vi.stubEnv("QVERIS_API_KEY", "");
    expect(resolveQverisApiKey(undefined)).toBeUndefined();
  });

  it("omits all tools when no API key is configured", () => {
    vi.stubEnv("QVERIS_API_KEY", "");
    const tools = createQverisTools({ api: fakeApi({ enabled: true }), ctx: fakeCtx() });
    expect(tools).toBeNull();
  });

  it("uses the built-in base URL by default", () => {
    expect(resolveQverisBaseUrl(undefined)).toBe(DEFAULT_QVERIS_BASE_URL);
  });

  it("uses QVERIS_BASE_URL when no plugin override is configured", () => {
    vi.stubEnv("QVERIS_BASE_URL", "https://proxy.example/qveris/");
    expect(resolveQverisBaseUrl(undefined)).toBe("https://proxy.example/qveris");
  });

  it("validates QVERIS_BASE_URL instead of silently falling back", () => {
    vi.stubEnv("QVERIS_BASE_URL", "");
    expect(() => resolveQverisBaseUrl(undefined)).toThrow(/must not be empty/);
  });

  it("prefers plugin baseUrl over QVERIS_BASE_URL", () => {
    vi.stubEnv("QVERIS_BASE_URL", "https://env.example/api/v1");
    expect(resolveQverisBaseUrl({ baseUrl: "https://config.example/api/v1" })).toBe("https://config.example/api/v1");
  });

  it.each([undefined, null])("treats an optional baseUrl value of %s as unset", (baseUrl) => {
    vi.stubEnv("QVERIS_BASE_URL", "https://env.example/api/v1");
    expect(resolveQverisBaseUrl({ baseUrl })).toBe("https://env.example/api/v1");
  });

  it("does not derive the endpoint from API key metadata", () => {
    expect(resolveQverisBaseUrl({ apiKey: "sk-cn-example" })).toBe(DEFAULT_QVERIS_BASE_URL);
  });

  it("normalizes surrounding whitespace and trailing slashes", () => {
    expect(resolveQverisBaseUrl({ baseUrl: "  https://proxy.example/qveris///  " })).toBe(
      "https://proxy.example/qveris",
    );
  });

  it.each(["global", "cn"])("rejects the legacy region setting %s with migration guidance", (region) => {
    expect(() => resolveQverisBaseUrl({ region })).toThrow(/region is no longer supported.*baseUrl.*QVERIS_BASE_URL/);
  });

  it.each([undefined, null])("treats an optional legacy region value of %s as unset", (region) => {
    expect(resolveQverisBaseUrl({ region })).toBe(DEFAULT_QVERIS_BASE_URL);
  });

  it.each([
    ["empty", ""],
    ["non-string", 42],
    ["unsupported scheme", "ftp://qveris.ai/api/v1"],
    ["protocol-relative", "//qveris.ai/api/v1"],
    ["whitespace", "https://qveris.ai/a b"],
    ["backslash", "https://qveris.ai\\api\\v1"],
    ["credentials", "https://user:pass@qveris.ai/api/v1"],
    ["query", "https://qveris.ai/api/v1?mode=test"],
    ["fragment", "https://qveris.ai/api/v1#test"],
  ])("rejects an invalid %s base URL", (_label, baseUrl) => {
    expect(() => resolveQverisBaseUrl({ baseUrl })).toThrow(/QVeris API base URL/);
  });

  it("resolveDiscoverTimeoutSeconds returns default when not set", () => {
    expect(resolveDiscoverTimeoutSeconds(undefined)).toBe(5);
  });

  it("resolveCallTimeoutSeconds returns default when not set", () => {
    expect(resolveCallTimeoutSeconds(undefined)).toBe(60);
  });

  it("resolveDiscoverTimeoutSeconds uses searchTimeoutSeconds", () => {
    expect(resolveDiscoverTimeoutSeconds({ searchTimeoutSeconds: 10 })).toBe(10);
  });

  it("resolveCallTimeoutSeconds uses executeTimeoutSeconds", () => {
    expect(resolveCallTimeoutSeconds({ executeTimeoutSeconds: 120 })).toBe(120);
  });

  it("allows the public domain matching the default endpoint", () => {
    expect(resolveFullContentAllowedDomains(undefined)).toEqual(["qveris.ai"]);
  });

  it("allows the public domain matching QVERIS_BASE_URL", () => {
    vi.stubEnv("QVERIS_BASE_URL", "https://qveris.cn/api/v1");
    expect(resolveFullContentAllowedDomains(undefined)).toEqual(["qveris.cn"]);
  });

  it("allows the parent public domain for an explicit subdomain endpoint", () => {
    expect(resolveFullContentAllowedDomains({ baseUrl: "https://api.qveris.cn/api/v1" })).toEqual(["qveris.cn"]);
  });

  it("does not expand full-content trust for an unknown custom endpoint", () => {
    expect(resolveFullContentAllowedDomains({ baseUrl: "https://proxy.example/qveris" })).toEqual([]);
  });
});
