import { normalizeSecretInput } from "openclaw/plugin-sdk/provider-auth";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";

export type QverisRegion = "global" | "cn";

export const QVERIS_REGION_DOMAINS: Record<QverisRegion, string> = {
  global: "qveris.ai",
  cn: "qveris.cn",
};

const DEFAULT_DISCOVER_TIMEOUT_SECONDS = 5;
const DEFAULT_CALL_TIMEOUT_SECONDS = 60;
const DEFAULT_MAX_RESPONSE_SIZE = 20480;
const DEFAULT_DISCOVER_LIMIT = 10;
const DEFAULT_FULL_CONTENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_FULL_CONTENT_TIMEOUT_SECONDS = 30;

function normalizeConfiguredSecret(value: unknown, path: string): string | undefined {
  return normalizeSecretInput(
    normalizeResolvedSecretInputString({
      value,
      path,
    }),
  );
}

export function resolveQverisApiKey(pluginConfig: Record<string, unknown> | undefined): string | undefined {
  return (
    normalizeConfiguredSecret(pluginConfig?.apiKey, "plugins.entries.qveris.config.apiKey") ||
    normalizeSecretInput(process.env.QVERIS_API_KEY) ||
    undefined
  );
}

export function resolveQverisRegion(pluginConfig: Record<string, unknown> | undefined): QverisRegion {
  return pluginConfig?.region === "cn" ? "cn" : "global";
}

export function resolveQverisBaseUrl(pluginConfig: Record<string, unknown> | undefined): string {
  const explicit = typeof pluginConfig?.baseUrl === "string" ? pluginConfig.baseUrl.trim() : "";
  if (explicit) {
    return explicit;
  }
  const region = resolveQverisRegion(pluginConfig);
  return `https://${QVERIS_REGION_DOMAINS[region]}/api/v1`;
}

/**
 * Returns the allowed domains for full-content downloads.
 * Includes the region domain plus the baseUrl domain if it resolves to a known QVeris domain.
 */
export function resolveFullContentAllowedDomains(pluginConfig: Record<string, unknown> | undefined): string[] {
  const region = resolveQverisRegion(pluginConfig);
  const domains = new Set<string>([QVERIS_REGION_DOMAINS[region]]);

  const explicit = typeof pluginConfig?.baseUrl === "string" ? pluginConfig.baseUrl.trim() : "";
  if (explicit) {
    try {
      const host = new URL(explicit).hostname.toLowerCase();
      const allKnownDomains = Object.values(QVERIS_REGION_DOMAINS);
      for (const d of allKnownDomains) {
        if (host === d || host.endsWith(`.${d}`)) {
          domains.add(d);
        }
      }
    } catch {
      // invalid baseUrl — ignore, region domain still in set
    }
  }

  return [...domains];
}

export function resolveDiscoverTimeoutSeconds(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.searchTimeoutSeconds;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_DISCOVER_TIMEOUT_SECONDS;
}

export function resolveCallTimeoutSeconds(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.executeTimeoutSeconds;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_CALL_TIMEOUT_SECONDS;
}

export function resolveMaxResponseSize(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.maxResponseSize;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_MAX_RESPONSE_SIZE;
}

export function resolveDiscoverLimit(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.searchLimit;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_DISCOVER_LIMIT;
}

export function resolveAutoMaterialize(pluginConfig: Record<string, unknown> | undefined): boolean {
  return pluginConfig?.autoMaterializeFullContent === true;
}

export function resolveFullContentMaxBytes(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.fullContentMaxBytes;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_FULL_CONTENT_MAX_BYTES;
}

export function resolveFullContentTimeoutSeconds(pluginConfig: Record<string, unknown> | undefined): number {
  const v = pluginConfig?.fullContentTimeoutSeconds;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_FULL_CONTENT_TIMEOUT_SECONDS;
}
