import { normalizeSecretInput } from "openclaw/plugin-sdk/provider-auth";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";

export const DEFAULT_QVERIS_BASE_URL = "https://qveris.ai/api/v1";

const QVERIS_PUBLIC_DOMAINS = ["qveris.ai", "qveris.cn"] as const;

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

function rejectLegacyRegion(pluginConfig: Record<string, unknown> | undefined): void {
  if (pluginConfig?.region !== undefined && pluginConfig.region !== null) {
    throw new Error("QVeris region is no longer supported; remove it and set baseUrl or QVERIS_BASE_URL explicitly");
  }
}

function normalizeQverisBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("QVeris API base URL must be a string");
  }

  const candidate = value.trim();
  if (!candidate) {
    throw new Error("QVeris API base URL must not be empty");
  }
  if (!/^https?:\/\/[^/?#\s\\]/i.test(candidate) || /\s/.test(candidate) || candidate.includes("\\")) {
    throw new Error("QVeris API base URL must be a valid HTTP(S) URL");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("QVeris API base URL must be a valid HTTP(S) URL");
  }

  if (!new Set(["http:", "https:"]).has(url.protocol) || !url.hostname) {
    throw new Error("QVeris API base URL must be a valid HTTP(S) URL");
  }
  if (url.username || url.password || candidate.includes("?") || candidate.includes("#")) {
    throw new Error("QVeris API base URL must not contain credentials, a query, or a fragment");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/** Priority: plugin config > QVERIS_BASE_URL > built-in default. */
export function resolveQverisBaseUrl(pluginConfig: Record<string, unknown> | undefined): string {
  rejectLegacyRegion(pluginConfig);
  if (pluginConfig?.baseUrl !== undefined && pluginConfig.baseUrl !== null) {
    return normalizeQverisBaseUrl(pluginConfig.baseUrl);
  }
  if (typeof process.env.QVERIS_BASE_URL === "string") {
    return normalizeQverisBaseUrl(process.env.QVERIS_BASE_URL);
  }
  return DEFAULT_QVERIS_BASE_URL;
}

/** Returns the trusted public QVeris domain matching the resolved API endpoint. */
export function resolveFullContentAllowedDomains(pluginConfig: Record<string, unknown> | undefined): string[] {
  const host = new URL(resolveQverisBaseUrl(pluginConfig)).hostname.toLowerCase();
  return QVERIS_PUBLIC_DOMAINS.filter((domain) => host === domain || host.endsWith(`.${domain}`));
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
