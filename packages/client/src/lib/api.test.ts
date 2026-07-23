import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, buildApiUrl } from "./api.js";

describe("buildApiUrl", () => {
  it("does not create double slashes when base URL has a trailing slash", () => {
    expect(buildApiUrl("https://timedata.yanzhou.icu/", "/api/sync/pull")).toBe(
      "https://timedata.yanzhou.icu/api/sync/pull",
    );
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns undefined for 204 No Content responses", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch("/api/sync/status")).resolves.toBeUndefined();
  });

  it("preserves JSON error body on API errors", async () => {
    const body = { outcomes: [{ status: "conflict", reasonCode: "overlap" }] };
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 409,
        statusText: "Conflict",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiFetch("/api/sync/push", { method: "POST" })).rejects.toMatchObject({
      status: 409,
      body,
    });
    await expect(apiFetch("/api/sync/push", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });

  it("preserves Retry-After response headers on ApiError", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "120" },
      }),
    );

    await expect(apiFetch("/api/sync/status")).rejects.toMatchObject({
      status: 429,
      headers: expect.any(Headers),
    });
    await apiFetch("/api/sync/status").catch((error: ApiError) => {
      expect(error.headers.get("Retry-After")).toBe("120");
    });
  });

  it("aborts after timeoutMs when no caller signal is provided", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
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

    await expect(apiFetch("/api/sync/pull", { timeoutMs: 50 })).rejects.toThrow(/超时/);
  });

  it("preserves the caller abort reason instead of reporting a network failure", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    const controller = new AbortController();
    const abortReason = new Error("route-change");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")));
        }),
    );

    const request = apiFetch("/api/sync/pull", { signal: controller.signal });
    controller.abort(abortReason);

    await expect(request).rejects.toMatchObject({ message: "route-change" });
  });

  it("reports successful response JSON parse failures with URL and body snippet", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));

    await expect(apiFetch("/api/version")).rejects.toThrow(
      "API 返回的 JSON 无法解析：https://example.com/api/version - <html>not json</html>",
    );
  });

  it("merges object headers with default content type and authorization", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_api_token", "tk");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await apiFetch("/api/sync/pull", { headers: { "X-Custom": "v" } });

    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tk");
    expect(headers.get("X-Custom")).toBe("v");
  });

  it("merges Headers instances with default content type and authorization", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_api_token", "tk");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await apiFetch("/api/sync/pull", { headers: new Headers({ "X-Custom": "v" }) });

    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tk");
    expect(headers.get("X-Custom")).toBe("v");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// 挂死但响应 abort 的 fetch mock（真 fetch 收到 abort 会 reject，普通 mock 不会——超时/abort 用例必须用它）
const hangingAbortableFetch = (_input: unknown, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

describe("apiFetch hedging", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首枪在 delayMs 内成功则只发一枪", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: 1 }));
    await expect(apiFetch("/api/sync/status", { hedge: { delayMs: 1500 } })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("delayMs 内响应头未到→第二枪并发，先回者胜、输家被 abort", async () => {
    let firstSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce((_input, init) => {
        firstSignal = (init?.signal as AbortSignal) ?? null;
        return new Promise<Response>(() => {});
      })
      .mockImplementationOnce(async () => jsonResponse({ winner: 2 }));
    const promise = apiFetch<{ winner: number }>("/api/sync/pull", { method: "POST", body: "{}", hedge: { delayMs: 1500 } });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toEqual({ winner: 2 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(true);
  });

  it("首枪网络错误→不等 delayMs 立即补枪", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    await expect(apiFetch("/api/sync/status", { hedge: { delayMs: 1500 } })).resolves.toEqual({ ok: 2 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("两枪都网络错误→按现有文案报网络失败，共 2 枪", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(apiFetch("/api/sync/status", { hedge: { delayMs: 1500 } })).rejects.toThrow(/请求失败|failed/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("对冲下总超时仍按 timeoutMs 生效", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingAbortableFetch);
    const promise = apiFetch("/api/sync/status", { hedge: { delayMs: 1500 }, timeoutMs: 15_000 });
    const assertion = expect(promise).rejects.toThrow(/超时|timeout/i);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("调用方 signal abort 原样抛且不补枪", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingAbortableFetch);
    const controller = new AbortController();
    const promise = apiFetch("/api/sync/status", { hedge: { delayMs: 1500 }, signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("不带 hedge：网络错误只发一枪（现状回归）", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(apiFetch("/api/sync/status")).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
