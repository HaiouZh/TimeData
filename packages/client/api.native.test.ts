// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapacitorHttp as CapacitorHttpType } from "@capacitor/core";
import { ApiError, apiFetch } from "./src/lib/api.js";

const { getPlatformMock, isPluginAvailableMock, requestMock } = vi.hoisted(() => ({
  getPlatformMock: vi.fn<() => string>(),
  isPluginAvailableMock: vi.fn<(name: string) => boolean>(),
  requestMock: vi.fn<typeof CapacitorHttpType.request>(),
}));

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, getPlatform: getPlatformMock, isPluginAvailable: isPluginAvailableMock },
    CapacitorHttp: { request: requestMock },
  };
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("apiFetch native Android transport", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    getPlatformMock.mockReset();
    isPluginAvailableMock.mockReset();
    requestMock.mockReset();
    getPlatformMock.mockReturnValue("android");
    isPluginAvailableMock.mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected web fetch"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses CapacitorHttp with the existing auth, build and caller headers", async () => {
    localStorage.setItem("timedata_api_token", "tk");
    requestMock.mockResolvedValue({
      data: { ok: true },
      status: 200,
      headers: { "content-type": "application/json" },
      url: "https://example.com/api/sync/pull",
    });

    await expect(
      apiFetch("/api/sync/pull", {
        method: "POST",
        body: JSON.stringify({ sinceSeq: 1 }),
        headers: { "X-TOTP-Code": "123456" },
        hedge: { delayMs: 1500 },
        transport: "native-android",
      }),
    ).resolves.toEqual({ ok: true });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const options = requestMock.mock.calls[0][0];
    const headers = new Headers(options.headers);
    expect(options).toMatchObject({
      url: "https://example.com/api/sync/pull",
      method: "POST",
      data: JSON.stringify({ sinceSeq: 1 }),
      connectTimeout: 15_000,
      readTimeout: 15_000,
    });
    expect(headers.get("Authorization")).toBe("Bearer tk");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-TimeData-Client-Build")).toBeTruthy();
    expect(headers.get("X-TOTP-Code")).toBe("123456");
  });

  it("normalizes empty native responses to undefined", async () => {
    requestMock.mockResolvedValue({
      data: "",
      status: 204,
      headers: {},
      url: "https://example.com/api/sync/status",
    });

    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).resolves.toBeUndefined();
  });

  it("keeps CapacitorHttp-decoded JSON arrays and string values", async () => {
    requestMock.mockResolvedValueOnce({ data: [1, 2], status: 200, headers: {}, url: "https://example.com/api/sync/status" });
    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).resolves.toEqual([1, 2]);

    requestMock.mockResolvedValueOnce({ data: "decoded", status: 200, headers: {}, url: "https://example.com/api/sync/status" });
    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).resolves.toBe("decoded");
  });

  it("maps native HTTP errors to ApiError with body and response headers", async () => {
    const body = { error: "rate_limited", retryAfterSec: 7 };
    requestMock.mockResolvedValue({
      data: body,
      status: 429,
      headers: { "Retry-After": "7" },
      url: "https://example.com/api/sync/status",
    });

    await apiFetch("/api/sync/status", { transport: "native-android" }).catch((error: ApiError) => {
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(429);
      expect(error.body).toEqual(body);
      expect(error.headers.get("Retry-After")).toBe("7");
    });
  });

  it("parses a string JSON error body before exposing ApiError.body", async () => {
    requestMock.mockResolvedValue({
      data: JSON.stringify({ error: "rate_limited", retryAfterSec: 7 }),
      status: 429,
      headers: { "Retry-After": "7" },
      url: "https://example.com/api/sync/status",
    });

    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).rejects.toMatchObject({
      body: { error: "rate_limited", retryAfterSec: 7 },
    });
  });

  it("reports native bridge rejection as the existing network failure", async () => {
    requestMock.mockRejectedValue(new Error("bridge failed"));

    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).rejects.toThrow(
      /请求失败|failed/i,
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to fetch before sending outside Android", async () => {
    getPlatformMock.mockReturnValue("web");
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).resolves.toEqual({ ok: true });

    expect(requestMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to fetch when the native plugin is unavailable", async () => {
    isPluginAvailableMock.mockReturnValue(false);
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await expect(apiFetch("/api/sync/status", { transport: "native-android" })).resolves.toEqual({ ok: true });

    expect(requestMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns on total timeout without assuming the native request was cancelled", async () => {
    vi.useFakeTimers();
    let finishNative: (value: Awaited<ReturnType<typeof CapacitorHttp.request>>) => void = () => undefined;
    const nativePromise = new Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>>((resolve) => {
      finishNative = resolve;
    });
    requestMock.mockReturnValue(nativePromise);

    const request = apiFetch("/api/sync/status", { transport: "native-android", timeoutMs: 50 });
    const observed = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    await expect(observed).resolves.toEqual(expect.objectContaining({ message: expect.stringMatching(/超时|timeout/i) }));

    finishNative({ data: { late: true }, status: 200, headers: {}, url: "https://example.com/api/sync/status" });
    await nativePromise;
  });

  it("shares an active native request after one caller times out", async () => {
    vi.useFakeTimers();
    let finishNative: (value: Awaited<ReturnType<typeof CapacitorHttp.request>>) => void = () => undefined;
    const nativePromise = new Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>>((resolve) => {
      finishNative = resolve;
    });
    requestMock.mockReturnValue(nativePromise);

    const first = apiFetch("/api/sync/status", { transport: "native-android", timeoutMs: 50 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toEqual(expect.objectContaining({ message: expect.stringMatching(/超时|timeout/i) }));

    const second = apiFetch("/api/sync/status", { transport: "native-android", timeoutMs: 200 });
    expect(requestMock).toHaveBeenCalledTimes(1);
    finishNative({ data: { latestSeq: 2 }, status: 200, headers: {}, url: "https://example.com/api/sync/status" });
    await expect(second).resolves.toEqual({ latestSeq: 2 });
  });

  it("preserves caller abort while leaving the native request to finish", async () => {
    const controller = new AbortController();
    const abortReason = new Error("route-change");
    let finishNative: (value: Awaited<ReturnType<typeof CapacitorHttp.request>>) => void = () => undefined;
    const nativePromise = new Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>>((resolve) => {
      finishNative = resolve;
    });
    requestMock.mockReturnValue(nativePromise);

    const request = apiFetch("/api/sync/status", {
      transport: "native-android",
      signal: controller.signal,
    });
    controller.abort(abortReason);

    await expect(request).rejects.toBe(abortReason);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    finishNative({ data: { late: true }, status: 200, headers: {}, url: "https://example.com/api/sync/status" });
    await nativePromise;
  });

  it("does not start a native request when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already-aborted"));

    await expect(apiFetch("/api/sync/status", {
      transport: "native-android",
      signal: controller.signal,
    })).rejects.toThrow("already-aborted");

    expect(requestMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
