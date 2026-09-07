import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDiscoverCache, makeDiscoverResultTracker, makeToolRolodex } from "./qveris-cache.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("discover cache", () => {
  it("expires entries and supports explicit clearing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    const cache = makeDiscoverCache<string>();

    cache.write("weather:5", "first", 1_000);
    expect(cache.read("weather:5")).toBe("first");

    vi.advanceTimersByTime(1_001);
    expect(cache.read("weather:5")).toBeUndefined();

    cache.write("weather:5", "second", 1_000);
    cache.clear();
    expect(cache.read("weather:5")).toBeUndefined();
  });

  it("does not retain entries when the configured TTL is zero", () => {
    const cache = makeDiscoverCache<string>();
    cache.write("weather:5", "value", 0);
    expect(cache.read("weather:5")).toBeUndefined();
  });
});

describe("successful capability memory", () => {
  it("matches only the normalized exact capability query and expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    const rolodex = makeToolRolodex({ ttlMs: 1_000 });

    rolodex.record("weather.v1", {
      name: "Weather",
      description: "Current weather",
      discoveryQuery: " Weather   Forecast API ",
      discoveryId: "search-1",
    });

    expect(rolodex.lookup("weather.v1", "weather forecast api")?.discoveryId).toBe("search-1");
    expect(rolodex.lookup("weather.v1", "historical weather API")).toBeUndefined();
    expect(rolodex.getSummary("weather forecast api")).toHaveLength(1);
    expect(rolodex.getSummary("stock quote API")).toEqual([]);

    rolodex.clear("stock quote API");
    expect(rolodex.lookup("weather.v1")).toBeDefined();
    rolodex.clear(" weather forecast api ");
    expect(rolodex.lookup("weather.v1")).toBeUndefined();

    rolodex.record("weather.v1", {
      name: "Weather",
      description: "Current weather",
      discoveryQuery: "weather forecast API",
      discoveryId: "search-2",
    });

    vi.advanceTimersByTime(1_001);
    expect(rolodex.lookup("weather.v1")).toBeUndefined();
    expect(rolodex.isStale("weather.v1")).toBe(true);
    expect(rolodex.getSummary()).toEqual([]);
  });

  it("can be disabled without storing successful capabilities", () => {
    const rolodex = makeToolRolodex({ enabled: false });
    rolodex.record("weather.v1", {
      name: "Weather",
      description: "Current weather",
      discoveryQuery: "weather forecast API",
      discoveryId: "search-1",
    });
    expect(rolodex.lookup("weather.v1")).toBeUndefined();
    expect(rolodex.getSummary()).toEqual([]);
  });

  it("refreshes matching successful memory and drops success from another exact intent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    const rolodex = makeToolRolodex({ ttlMs: 1_000 });

    rolodex.record("weather.v1", {
      name: "Weather",
      description: "Current weather",
      discoveryQuery: "weather forecast API",
    });
    vi.advanceTimersByTime(500);
    rolodex.reconcileFreshDiscovery("weather.v1", {
      name: "Fresh Weather",
      description: "Fresh current weather",
      discoveryQuery: "weather forecast API",
      discoveryId: "search-2",
      parameterContract: [{ name: "city", required: true }],
      contractExpiresAt: Date.now() + 5_000,
      metadataSource: "discover",
    });
    vi.advanceTimersByTime(501);
    expect(rolodex.isStale("weather.v1")).toBe(false);
    expect(rolodex.lookup("weather.v1")?.discoveryId).toBe("search-2");

    rolodex.reconcileFreshDiscovery("weather.v1", {
      name: "Historical Weather",
      description: "Historical weather",
      discoveryQuery: "historical weather API",
      discoveryId: "search-3",
    });
    expect(rolodex.lookup("weather.v1")).toBeUndefined();
  });
});

describe("discover correlation tracker", () => {
  it("expires search attribution independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    const tracker = makeDiscoverResultTracker({ ttlMs: 1_000 });
    tracker.trackResults(
      "weather forecast API",
      [{ tool_id: "weather.v1", name: "Weather", description: "Current weather" }],
      "search-1",
    );
    expect(tracker.getMeta("weather.v1")?.searchId).toBe("search-1");
    vi.advanceTimersByTime(1_001);
    expect(tracker.getMeta("weather.v1")).toBeUndefined();
  });
});
