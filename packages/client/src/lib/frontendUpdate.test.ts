import { describe, expect, it, vi } from "vitest";
import { fetchLatestBuildId, hardRefresh, hasFrontendUpdate } from "./frontendUpdate.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe("fetchLatestBuildId", () => {
  it("returns buildId from version.json with no-store", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ buildId: "abc" }));

    expect(await fetchLatestBuildId(fetchFn as unknown as typeof fetch)).toBe("abc");
    expect(fetchFn).toHaveBeenCalledWith("/version.json", { cache: "no-store" });
  });

  it("returns null on non-ok response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ buildId: "x" }, false));

    expect(await fetchLatestBuildId(fetchFn as unknown as typeof fetch)).toBeNull();
  });

  it("returns null when fetch throws while offline", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });

    expect(await fetchLatestBuildId(fetchFn as unknown as typeof fetch)).toBeNull();
  });

  it("returns null when buildId is missing or not a string", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ buildId: 123 }));

    expect(await fetchLatestBuildId(fetchFn as unknown as typeof fetch)).toBeNull();
  });
});

describe("hasFrontendUpdate", () => {
  it("is true when latest differs from current", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ buildId: "new" }));

    expect(await hasFrontendUpdate("old", fetchFn as unknown as typeof fetch)).toBe(true);
  });

  it("is false when latest equals current", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ buildId: "same" }));

    expect(await hasFrontendUpdate("same", fetchFn as unknown as typeof fetch)).toBe(false);
  });

  it("is false when version cannot be fetched", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("x");
    });

    expect(await hasFrontendUpdate("old", fetchFn as unknown as typeof fetch)).toBe(false);
  });
});

describe("hardRefresh", () => {
  it("unregisters service workers, clears caches, then reloads", async () => {
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    const reload = vi.fn();
    const serviceWorker = { getRegistrations: vi.fn(async () => [{ unregister }, { unregister }]) };
    const cacheStorage = { keys: vi.fn(async () => ["a", "b"]), delete: deleteCache };

    await hardRefresh({
      serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      cacheStorage: cacheStorage as unknown as CacheStorage,
      reload,
    });

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads when service workers and caches are unavailable", async () => {
    const reload = vi.fn();

    await hardRefresh({ reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads even when unregister rejects", async () => {
    const reload = vi.fn();
    const serviceWorker = {
      getRegistrations: vi.fn(async () => {
        throw new Error("x");
      }),
    };

    await hardRefresh({ serviceWorker: serviceWorker as unknown as ServiceWorkerContainer, reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
