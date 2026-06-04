import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  resolveQverisApiKey,
  resolveQverisBaseUrl,
  resolveQverisRegion,
  resolveDiscoverTimeoutSeconds,
  resolveCallTimeoutSeconds,
  resolveFullContentAllowedDomains,
  QVERIS_REGION_DOMAINS,
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

  it("resolves global region by default", () => {
    expect(resolveQverisRegion(undefined)).toBe("global");
    expect(resolveQverisRegion({})).toBe("global");
  });

  it("resolves cn region when configured", () => {
    expect(resolveQverisRegion({ region: "cn" })).toBe("cn");
  });

  it("builds global base URL from region domain", () => {
    expect(resolveQverisBaseUrl(undefined)).toBe(`https://${QVERIS_REGION_DOMAINS.global}/api/v1`);
  });

  it("builds cn base URL from region", () => {
    expect(resolveQverisBaseUrl({ region: "cn" })).toBe(
      `https://${QVERIS_REGION_DOMAINS.cn}/api/v1`,
    );
  });

  it("uses explicit baseUrl when provided", () => {
    expect(resolveQverisBaseUrl({ baseUrl: "https://proxy.example/qveris" })).toBe(
      "https://proxy.example/qveris",
    );
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

  it("full-content allowed domains includes region domain", () => {
    const domains = resolveFullContentAllowedDomains(undefined);
    expect(domains).toContain(QVERIS_REGION_DOMAINS.global);
  });

  it("full-content allowed domains for cn region contains qveris.cn only", () => {
    const domains = resolveFullContentAllowedDomains({ region: "cn" });
    expect(domains).toContain(QVERIS_REGION_DOMAINS.cn);
    expect(domains).not.toContain(QVERIS_REGION_DOMAINS.global);
  });

  it("full-content allowed domains extends to baseUrl qveris domain", () => {
    const domains = resolveFullContentAllowedDomains({
      region: "global",
      baseUrl: "https://qveris.cn/api/v1",
    });
    expect(domains).toContain(QVERIS_REGION_DOMAINS.global);
    expect(domains).toContain(QVERIS_REGION_DOMAINS.cn);
  });

  it("subdomain of region domain is allowed for cn region", () => {
    const domains = resolveFullContentAllowedDomains({ region: "cn" });
    const ossHostname = `oss.${QVERIS_REGION_DOMAINS.cn}`;
    const allowed = domains.some(
      (d) => ossHostname === d || ossHostname.endsWith(`.${d}`),
    );
    expect(allowed).toBe(true);
  });

  it("subdomain of region domain is allowed for global region", () => {
    const domains = resolveFullContentAllowedDomains(undefined);
    const ossHostname = `oss.${QVERIS_REGION_DOMAINS.global}`;
    const allowed = domains.some(
      (d) => ossHostname === d || ossHostname.endsWith(`.${d}`),
    );
    expect(allowed).toBe(true);
  });
});
