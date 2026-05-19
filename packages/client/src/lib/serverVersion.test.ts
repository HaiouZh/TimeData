import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchServerVersion } from "./serverVersion.js";

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const versionInfo = {
  current: "1.0.0",
  latest: "1.0.1",
  hasUpdate: true,
  checkedAt: "2026-05-13T00:00:00.000Z",
};

describe("serverVersion", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("fetchServerVersion returns version info and passes Authorization header via apiFetch", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    localStorage.setItem("timedata_api_token", "tk");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(versionInfo)));

    await expect(fetchServerVersion()).resolves.toEqual({ ok: true, version: versionInfo });

    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://x/api/version");
    expect(headers.get("Authorization")).toBe("Bearer tk");
  });

  it("fetchServerVersion returns the concrete apiFetch error message", async () => {
    vi.useFakeTimers();
    localStorage.setItem("timedata_api_url", "http://x");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const result = fetchServerVersion();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toEqual({
      ok: false,
      error: "网络请求超时（15000ms）：http://x/api/version",
    });
    vi.useRealTimers();
  });
});
