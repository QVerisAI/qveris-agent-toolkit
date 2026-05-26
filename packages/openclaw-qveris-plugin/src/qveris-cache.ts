// Pure in-memory session-scoped state — no external dependencies.

// ============================================================================
// Discover Cache (short-TTL, avoids redundant API calls within a session)
// ============================================================================

const DEFAULT_DISCOVER_CACHE_TTL_MS = 90_000; // 90 seconds

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
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  return { read, write };
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
}

export function makeToolRolodex() {
  const store = new Map<string, RolodexEntry>();

  function record(
    toolId: string,
    meta: { name: string; description: string; discoveryQuery: string; discoveryId?: string },
  ): void {
    const existing = store.get(toolId);
    if (existing) {
      existing.successCount += 1;
      existing.lastUsedAt = Date.now();
      existing.discoveryId = meta.discoveryId ?? existing.discoveryId;
    } else {
      store.set(toolId, {
        toolId,
        name: meta.name,
        description: meta.description,
        successCount: 1,
        lastUsedAt: Date.now(),
        discoveryQuery: meta.discoveryQuery,
        discoveryId: meta.discoveryId,
      });
    }
  }

  function lookup(toolId: string): RolodexEntry | undefined {
    return store.get(toolId);
  }

  function getSummary(): Array<{ tool_id: string; name: string; uses: number }> {
    return Array.from(store.values()).map((e) => ({
      tool_id: e.toolId,
      name: e.name,
      uses: e.successCount,
    }));
  }

  return { record, lookup, getSummary };
}

// ============================================================================
// Discover Result Tracker — maps tool_id → discovery metadata (name, description, query, searchId)
// ============================================================================

interface DiscoverResultMeta {
  name: string;
  description: string;
  query: string;
  searchId?: string;
}

export function makeDiscoverResultTracker() {
  const store = new Map<string, DiscoverResultMeta>();

  function trackResults(
    query: string,
    tools: Array<{ tool_id: string; name: string; description: string }>,
    searchId?: string,
  ): void {
    for (const tool of tools) {
      const existing = store.get(tool.tool_id);
      store.set(tool.tool_id, {
        name: tool.name,
        description: tool.description,
        // Preserve original discovery query; "(inspect)" does not overwrite it
        query: query === "(inspect)" ? (existing?.query ?? query) : query,
        searchId: searchId ?? existing?.searchId,
      });
    }
  }

  function getMeta(toolId: string): DiscoverResultMeta | undefined {
    return store.get(toolId);
  }

  return { trackResults, getMeta };
}
