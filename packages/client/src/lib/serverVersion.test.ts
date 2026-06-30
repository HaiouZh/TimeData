import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchServerVersion, pollServerUpdate, triggerServerUpdate } from "./serverVersion.js";

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
  checkOk: true,
};

function runningStatus(overrides: Record<string, unknown> = {}) {
  return {
    updateId: "u",
    status: "running" as const,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    logTail: "",
    ...overrides,
  };
}

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

  it("fetchServerVersion force=true appends ?refresh=1 to bypass server cache", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(versionInfo)));

    await fetchServerVersion({ force: true });

    expect(fetchSpy.mock.calls[0][0]).toBe("http://x/api/version?refresh=1");
  });

  it("triggerServerUpdate returns ok with updateId", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ updateId: "update-9" })));

    await expect(triggerServerUpdate()).resolves.toEqual({ ok: true, updateId: "update-9" });
  });

  it("triggerServerUpdate surfaces 409 already-running with the running updateId", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    const body = JSON.stringify({
      ok: false,
      error: { code: "CONFLICT", message: "update already running", details: { updateId: "update-5" } },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 409 }));

    await expect(triggerServerUpdate()).resolves.toEqual({
      ok: false,
      reason: "already-running",
      updateId: "update-5",
    });
  });

  it("triggerServerUpdate returns error reason on other failures", async () => {
    localStorage.setItem("timedata_api_url", "http://x");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    const result = await triggerServerUpdate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
  });

  it("pollServerUpdate succeeds once the running sha changes", async () => {
    let clock = 0;
    const fetchVersion = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, version: { ...versionInfo, current: "oldsha1" } })
      .mockResolvedValueOnce({ ok: true, version: { ...versionInfo, current: "newsha2" } });

    const outcome = await pollServerUpdate({
      fromSha: "oldsha1",
      deps: {
        fetchStatus: vi.fn().mockResolvedValue(runningStatus()),
        fetchVersion,
        sleep: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      },
      intervalMs: 10,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({ kind: "succeeded", version: "newsha2" });
  });

  it("pollServerUpdate fails when status reports failed", async () => {
    const outcome = await pollServerUpdate({
      fromSha: "oldsha1",
      deps: {
        fetchStatus: vi.fn().mockResolvedValue(runningStatus({ status: "failed", logTail: "boom happened" })),
        fetchVersion: vi.fn().mockResolvedValue({ ok: false, error: "" }),
        sleep: async () => {},
        now: () => 0,
      },
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.message).toContain("boom");
  });

  it("pollServerUpdate times out when the sha never changes", async () => {
    let clock = 0;
    const outcome = await pollServerUpdate({
      fromSha: "oldsha1",
      deps: {
        fetchStatus: vi.fn().mockResolvedValue(null),
        fetchVersion: vi.fn().mockResolvedValue({ ok: true, version: { ...versionInfo, current: "oldsha1" } }),
        sleep: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      },
      intervalMs: 100,
      timeoutMs: 250,
    });

    expect(outcome).toEqual({ kind: "timeout" });
  });
});
