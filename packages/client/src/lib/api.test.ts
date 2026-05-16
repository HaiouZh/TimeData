import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildApiUrl, apiFetch } from "./api.js";

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

describe("buildApiUrl", () => {
  it("does not create double slashes when base URL has a trailing slash", () => {
    expect(buildApiUrl("https://timedata.yanzhou.icu/", "/api/sync/pull"))
      .toBe("https://timedata.yanzhou.icu/api/sync/pull");
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("preserves JSON error body on API errors", async () => {
    const body = { outcomes: [{ status: "conflict", reasonCode: "overlap" }] };
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), {
      status: 409,
      statusText: "Conflict",
      headers: { "Content-Type": "application/json" },
    }));

    await expect(apiFetch("/api/sync/push", { method: "POST" })).rejects.toMatchObject({
      status: 409,
      body,
    });
    await expect(apiFetch("/api/sync/push", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });

  it("aborts after timeoutMs", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    await expect(apiFetch("/api/sync/pull", { timeoutMs: 50 })).rejects.toThrow(/超时/);
  });
});
