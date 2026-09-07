// Pure in-memory session-scoped state — no external dependencies.

// ============================================================================
// Discover Cache (short-TTL, avoids redundant API calls within a session)
// ============================================================================

const DEFAULT_DISCOVER_CACHE_TTL_MS = 90_000; // 90 seconds
const DEFAULT_CAPABILITY_MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface DiscoverCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function makeDiscoverCache<T>() {
  const store = new Map<string, DiscoverCacheEntry<T>>();

  function read(key: string): T | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function write(key: string, value: T, ttlMs = DEFAULT_DISCOVER_CACHE_TTL_MS): void {
    if (ttlMs <= 0) {
      store.delete(key);
      return;
    }
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function clear(): void {
    store.clear();
  }

  return { read, write, clear };
}

// ============================================================================
// Tool Rolodex — remembers successfully called tools for the session
// ============================================================================

interface RolodexEntry {
  toolId: string;
  name: string;
  description: string;
  successCount: number;
  lastUsedAt: number;
  discoveryQuery: string;
  discoveryId?: string;
  expiresAt: number;
  parameterContract?: unknown[];
  contractExpiresAt?: number;
  metadataSource?: "discover" | "inspect";
}

function normalizedCapabilityQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function makeToolRolodex(options: { ttlMs?: number; enabled?: boolean } = {}) {
  const store = new Map<string, RolodexEntry>();
  const ttlMs = options.ttlMs ?? DEFAULT_CAPABILITY_MEMORY_TTL_MS;
  const enabled = options.enabled ?? true;

  function currentEntry(toolId: string): RolodexEntry | undefined {
    const entry = store.get(toolId);
    if (!entry) return undefined;
    if (!enabled || ttlMs <= 0 || Date.now() > entry.expiresAt) {
      return undefined;
    }
    return entry;
  }

  function record(
    toolId: string,
    meta: {
      name: string;
      description: string;
      discoveryQuery: string;
      discoveryId?: string;
      parameterContract?: unknown[];
      contractExpiresAt?: number;
      metadataSource?: "discover" | "inspect";
    },
  ): void {
    if (!enabled || ttlMs <= 0) return;
    const existing = currentEntry(toolId);
    if (existing) {
      existing.successCount += 1;
      existing.lastUsedAt = Date.now();
      existing.discoveryId = meta.discoveryId ?? existing.discoveryId;
      existing.discoveryQuery = meta.discoveryQuery;
      existing.expiresAt = Date.now() + ttlMs;
      if (meta.parameterContract !== undefined) {
        existing.parameterContract = meta.parameterContract;
        existing.contractExpiresAt = meta.contractExpiresAt;
        existing.metadataSource = meta.metadataSource;
      }
    } else {
      store.set(toolId, {
        toolId,
        name: meta.name,
        description: meta.description,
        successCount: 1,
        lastUsedAt: Date.now(),
        discoveryQuery: meta.discoveryQuery,
        discoveryId: meta.discoveryId,
        expiresAt: Date.now() + ttlMs,
        parameterContract: meta.parameterContract,
        contractExpiresAt: meta.contractExpiresAt,
        metadataSource: meta.metadataSource,
      });
    }
  }

  function lookup(toolId: string, discoveryQuery?: string): RolodexEntry | undefined {
    const entry = currentEntry(toolId);
    if (!entry || discoveryQuery === undefined) return entry;
    return normalizedCapabilityQuery(entry.discoveryQuery) === normalizedCapabilityQuery(discoveryQuery)
      ? entry
      : undefined;
  }

  function isStale(toolId: string): boolean {
    const entry = store.get(toolId);
    if (!entry) return false;
    return !enabled || ttlMs <= 0 || Date.now() > entry.expiresAt;
  }

  function getSummary(discoveryQuery?: string): Array<{
    tool_id: string;
    name: string;
    uses: number;
    last_used_at: string;
  }> {
    const queryKey = discoveryQuery === undefined ? undefined : normalizedCapabilityQuery(discoveryQuery);
    return Array.from(store.keys())
      .map(currentEntry)
      .filter((entry): entry is RolodexEntry => Boolean(entry))
      .filter((entry) => queryKey === undefined || normalizedCapabilityQuery(entry.discoveryQuery) === queryKey)
      .map((entry) => ({
        tool_id: entry.toolId,
        name: entry.name,
        uses: entry.successCount,
        last_used_at: new Date(entry.lastUsedAt).toISOString(),
      }));
  }

  function clear(discoveryQuery?: string): void {
    if (discoveryQuery === undefined) {
      store.clear();
      return;
    }
    const queryKey = normalizedCapabilityQuery(discoveryQuery);
    for (const [toolId, entry] of store) {
      if (normalizedCapabilityQuery(entry.discoveryQuery) === queryKey) store.delete(toolId);
    }
  }

  return { record, lookup, isStale, getSummary, clear };
}

// ============================================================================
// Discover Result Tracker — maps tool_id → discovery metadata (name, description, query, searchId)
// ============================================================================

interface DiscoverResultMeta {
  name: string;
  description: string;
  query: string;
  searchId?: string;
  expiresAt: number;
  parameterContract?: unknown[];
  metadataSource: "discover" | "inspect";
}

export function makeDiscoverResultTracker(options: { ttlMs?: number } = {}) {
  const store = new Map<string, DiscoverResultMeta>();
  const ttlMs = options.ttlMs ?? DEFAULT_CAPABILITY_MEMORY_TTL_MS;

  function trackResults(
    query: string,
    tools: Array<{ tool_id: string; name: string; description: string; params?: unknown[] }>,
    searchId?: string,
    metadataSource: "discover" | "inspect" = "discover",
  ): void {
    for (const tool of tools) {
      const existing = getMeta(tool.tool_id);
      store.set(tool.tool_id, {
        name: tool.name,
        description: tool.description,
        // Preserve original discovery query; "(inspect)" does not overwrite it
        query: query === "(inspect)" ? (existing?.query ?? query) : query,
        searchId: searchId ?? existing?.searchId,
        expiresAt: Date.now() + ttlMs,
        parameterContract: tool.params,
        metadataSource,
      });
    }
  }

  function getMeta(toolId: string): DiscoverResultMeta | undefined {
    const entry = store.get(toolId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(toolId);
      return undefined;
    }
    return entry;
  }

  return { trackResults, getMeta };
}
