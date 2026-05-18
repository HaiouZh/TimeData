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
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("fetchServerVersion passes Authorization header via apiFetch", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    localStorage.setItem("timedata_api_token", "tk");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(versionInfo)));

    await expect(fetchServerVersion()).resolves.toEqual(versionInfo);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/version",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tk" }),
      }),
    );
  });
});
