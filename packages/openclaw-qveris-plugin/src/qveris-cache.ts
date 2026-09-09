// Pure in-memory session-scoped state — no external dependencies.

// ============================================================================
// Discover Cache (short-TTL, avoids redundant API calls within a session)
// ============================================================================

const DEFAULT_DISCOVER_CACHE_TTL_MS = 90_000; // 90 seconds
const DEFAULT_CAPABILITY_MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface DiscoverCacheEntry<T> {
  value: T;
  acquiredAt: number;
  expiresAt: number;
}

export function makeDiscoverCache<T>() {
  const store = new Map<string, DiscoverCacheEntry<T>>();

  function readEntry(key: string): DiscoverCacheEntry<T> | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  function read(key: string): T | undefined {
    return readEntry(key)?.value;
  }

  function write(key: string, value: T, ttlMs = DEFAULT_DISCOVER_CACHE_TTL_MS): void {
    if (ttlMs <= 0) {
      store.delete(key);
      return;
    }
    const acquiredAt = Date.now();
    store.set(key, { value, acquiredAt, expiresAt: acquiredAt + ttlMs });
  }

  function clear(): void {
    store.clear();
  }

  return { read, readEntry, write, clear };
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
    if (!enabled || ttlMs <= 0 || Date.now() >= entry.expiresAt) {
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
    return !enabled || ttlMs <= 0 || Date.now() >= entry.expiresAt;
  }

  function reconcileFreshDiscovery(
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
    const entry = store.get(toolId);
    if (!entry) return;

    if (normalizedCapabilityQuery(entry.discoveryQuery) !== normalizedCapabilityQuery(meta.discoveryQuery)) {
      // The success belongs to another exact intent. Fresh discovery is valid
      // provenance for Call, but it must earn a new success hint separately.
      store.delete(toolId);
      return;
    }

    entry.name = meta.name;
    entry.description = meta.description;
    entry.discoveryId = meta.discoveryId;
    entry.parameterContract = meta.parameterContract;
    entry.contractExpiresAt = meta.contractExpiresAt;
    entry.metadataSource = meta.metadataSource;
    entry.expiresAt = Date.now() + ttlMs;
  }

  function reconcileFreshInspection(
    toolId: string,
    meta: {
      name: string;
      description: string;
      parameterContract?: unknown[];
      contractExpiresAt?: number;
    },
  ): void {
    const entry = currentEntry(toolId);
    if (!entry) return;

    // Inspect refreshes the contract of a still-valid route. It cannot revive
    // expired discovery provenance or extend the route's independent TTL.
    entry.name = meta.name;
    entry.description = meta.description;
    entry.parameterContract = meta.parameterContract;
    entry.contractExpiresAt = meta.contractExpiresAt;
    entry.metadataSource = "inspect";
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

  return {
    record,
    lookup,
    isStale,
    reconcileFreshDiscovery,
    reconcileFreshInspection,
    getSummary,
    clear,
  };
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
  contractExpiresAt: number;
  parameterContract?: unknown[];
  metadataSource: "discover" | "inspect";
  ambiguousProvenance: boolean;
}

interface DiscoveryContext {
  queryKey: string;
  query: string;
  searchId?: string;
  acquiredAt: number;
  expiresAt: number;
}

interface DiscoverResultRecord {
  name: string;
  description: string;
  metadataAcquiredAt: number;
  contractAcquiredAt: number;
  contractExpiresAt: number;
  parameterContract?: unknown[];
  metadataSource: "discover" | "inspect";
  discoveryContexts: Map<string, DiscoveryContext>;
  // Keep a tombstone after all routes expire. Inspect may create metadata for a
  // never-discovered tool, but it must never turn an expired route into that
  // more permissive inspection-only state.
  hadDiscovery: boolean;
}

export function makeDiscoverResultTracker(options: { ttlMs?: number } = {}) {
  const store = new Map<string, DiscoverResultRecord>();
  const contextAcquiredAt = new Map<string, number>();
  const ttlMs = options.ttlMs ?? DEFAULT_CAPABILITY_MEMORY_TTL_MS;

  function liveContexts(entry: DiscoverResultRecord): DiscoveryContext[] {
    const now = Date.now();
    for (const [key, context] of entry.discoveryContexts) {
      if (now >= context.expiresAt) entry.discoveryContexts.delete(key);
    }
    return Array.from(entry.discoveryContexts.values());
  }

  function liveRoutes(entry: DiscoverResultRecord): DiscoveryContext[] {
    const routes = new Map<string, DiscoveryContext>();
    for (const context of liveContexts(entry)) {
      const existing = routes.get(context.queryKey);
      if (!existing || context.acquiredAt >= existing.acquiredAt) routes.set(context.queryKey, context);
    }
    return Array.from(routes.values());
  }

  function materializeMeta(
    entry: DiscoverResultRecord,
    context: DiscoveryContext | undefined,
    ambiguousProvenance: boolean,
  ): DiscoverResultMeta {
    return {
      name: entry.name,
      description: entry.description,
      query: context?.query ?? "(inspect)",
      searchId: context?.searchId,
      expiresAt: context?.expiresAt ?? entry.contractExpiresAt,
      contractExpiresAt: entry.contractExpiresAt,
      parameterContract: entry.parameterContract,
      metadataSource: entry.metadataSource,
      ambiguousProvenance,
    };
  }

  function trackResults(
    query: string,
    tools: Array<{ tool_id: string; name: string; description: string; params?: unknown[] }>,
    options: {
      searchId?: string;
      metadataSource?: "discover" | "inspect";
      acquiredAt?: number;
      expiresAt?: number;
      contextKey?: string;
    } = {},
  ): void {
    const metadataSource = options.metadataSource ?? "discover";
    const acquiredAt = options.acquiredAt ?? Date.now();
    const expiresAt = options.expiresAt ?? acquiredAt + ttlMs;
    const queryKey = normalizedCapabilityQuery(query);
    const contextKey = options.contextKey ?? queryKey;
    if (metadataSource === "discover") {
      const latestAcquiredAt = contextAcquiredAt.get(contextKey);
      if (latestAcquiredAt !== undefined && acquiredAt < latestAcquiredAt) return;
      contextAcquiredAt.set(contextKey, acquiredAt);
      // A response is authoritative for its exact cache variant (query +
      // projection inputs such as limit), not for newer sibling variants.
      for (const entry of store.values()) entry.discoveryContexts.delete(contextKey);
    }

    for (const tool of tools) {
      let entry = store.get(tool.tool_id);
      if (!entry) {
        entry = {
          name: tool.name,
          description: tool.description,
          metadataAcquiredAt: Number.NEGATIVE_INFINITY,
          contractAcquiredAt: Number.NEGATIVE_INFINITY,
          contractExpiresAt: 0,
          metadataSource,
          discoveryContexts: new Map(),
          hadDiscovery: false,
        };
        store.set(tool.tool_id, entry);
      }

      if (metadataSource === "discover") {
        entry.hadDiscovery = true;
        entry.discoveryContexts.set(contextKey, {
          queryKey,
          query,
          searchId: options.searchId,
          acquiredAt,
          expiresAt,
        });
      }

      if (acquiredAt >= entry.metadataAcquiredAt) {
        entry.name = tool.name;
        entry.description = tool.description;
        entry.metadataAcquiredAt = acquiredAt;
      }

      const contractIsLive = Date.now() < entry.contractExpiresAt;
      const shouldRefreshContract =
        (metadataSource === "inspect" && acquiredAt >= entry.contractAcquiredAt) ||
        (tool.params !== undefined && acquiredAt >= entry.contractAcquiredAt) ||
        !contractIsLive;
      if (shouldRefreshContract) {
        entry.parameterContract = tool.params;
        entry.contractAcquiredAt = acquiredAt;
        entry.contractExpiresAt = expiresAt;
        entry.metadataSource = metadataSource;
      }
    }
  }

  function getMeta(toolId: string): DiscoverResultMeta | undefined {
    const entry = store.get(toolId);
    if (!entry) return undefined;
    const routes = liveRoutes(entry);
    if (routes.length > 0) {
      const newestRoute = routes.reduce((newest, route) => (route.acquiredAt >= newest.acquiredAt ? route : newest));
      return materializeMeta(entry, newestRoute, routes.length > 1);
    }
    if (entry.hadDiscovery || Date.now() >= entry.contractExpiresAt) return undefined;
    return materializeMeta(entry, undefined, false);
  }

  function getMetaForContext(toolId: string, contextKey: string): DiscoverResultMeta | undefined {
    const entry = store.get(toolId);
    if (!entry) return undefined;
    const routes = liveRoutes(entry);
    const context = entry.discoveryContexts.get(contextKey);
    return context ? materializeMeta(entry, context, routes.length > 1) : undefined;
  }

  function isStale(toolId: string): boolean {
    const entry = store.get(toolId);
    if (!entry) return false;
    if (entry.hadDiscovery) return liveRoutes(entry).length === 0;
    return Date.now() >= entry.contractExpiresAt;
  }

  function getProvenanceStatus(toolId: string): "unique" | "ambiguous" | "inspection_only" | "expired" | "unknown" {
    const entry = store.get(toolId);
    if (!entry) return "unknown";
    const routes = liveRoutes(entry);
    if (routes.length > 1) return "ambiguous";
    if (routes.length === 1) return "unique";
    if (entry.hadDiscovery || Date.now() >= entry.contractExpiresAt) return "expired";
    return "inspection_only";
  }

  function resolveSearchId(toolId: string): string | undefined {
    const entry = getMeta(toolId);
    if (!entry || entry.query === "(inspect)" || entry.ambiguousProvenance) return undefined;
    return entry.searchId;
  }

  return { trackResults, getMeta, getMetaForContext, getProvenanceStatus, isStale, resolveSearchId };
}
