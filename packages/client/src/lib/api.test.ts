import { beforeEach, describe, expect, it, vi } from "vitest";
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
