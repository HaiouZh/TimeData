import { Capacitor, type CapacitorHttp } from "@capacitor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, buildApiUrl, nativeHttp, type LaneOutcome } from "./api.js";

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

// 2026-10-10 安卓事故：原生通道（HttpURLConnection）连不上时 WebView 那条已经通了，
// 同步却还在原生上干等；2026-10-13 反过来，WebView 那条 HTTP/2 连接卡住时原生是通的。
// 带 laneBackup 时主路失败立即、迟迟不回到点，都改走另一条车道。
// 原生请求按 url+headers 去重（模块级 map），挂死的 mock 会留在 map 里——每条用例用不同 path。
describe("apiFetch 安卓双车道", () => {
  type NativeResponse = Awaited<ReturnType<typeof CapacitorHttp.request>>;
  const nativeOk = (data: unknown): NativeResponse => ({ status: 200, data, headers: {}, url: "" });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("原生先回：只走原生，不发 WebView fetch，回报 native-android", async () => {
    vi.spyOn(nativeHttp, "request").mockResolvedValue(nativeOk({ ok: "native" }));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const servedBy: string[] = [];
    await expect(apiFetch("/api/sync/status?n=1", {
      transport: "native-android",
      laneBackup: { delayMs: 3000 },
      onServedBy: (t) => servedBy.push(t),
    })).resolves.toEqual({ ok: "native" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(servedBy).toEqual(["native-android"]);
  });

  it("原生网络错误：不等 delayMs 立即改走 WebView，回报 web", async () => {
    vi.spyOn(nativeHttp, "request").mockRejectedValue(new Error("UnknownHostException"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: "web" }));
    const servedBy: string[] = [];
    await expect(apiFetch("/api/sync/status?n=2", {
      transport: "native-android",
      laneBackup: { delayMs: 3000 },
      onServedBy: (t) => servedBy.push(t),
    })).resolves.toEqual({ ok: "web" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(servedBy).toEqual(["web"]);
  });

  it("原生挂住超过 delayMs：并发 WebView，先回者胜", async () => {
    vi.spyOn(nativeHttp, "request").mockReturnValue(new Promise<NativeResponse>(() => {}));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: "web" }));
    const promise = apiFetch("/api/sync/status?n=3", { transport: "native-android", laneBackup: { delayMs: 3000 } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ ok: "web" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("原生回了 HTTP 错误码：那是服务端的答复，照抛 ApiError，不改走 WebView", async () => {
    vi.spyOn(nativeHttp, "request").mockResolvedValue({ status: 500, data: { error: "boom" }, headers: {}, url: "" });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(apiFetch("/api/sync/status?n=4", {
      transport: "native-android",
      laneBackup: { delayMs: 3000 },
    })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("WebView 备份先败、原生仍挂着：总时限照样生效，不因备份收尾被清掉", async () => {
    vi.spyOn(nativeHttp, "request").mockReturnValue(new Promise<NativeResponse>(() => {}));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const promise = apiFetch("/api/sync/status?n=8", {
      transport: "native-android",
      laneBackup: { delayMs: 3000 },
      timeoutMs: 15_000,
    });
    const assertion = expect(promise).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("两条都失败：报网络失败", async () => {
    vi.spyOn(nativeHttp, "request").mockRejectedValue(new Error("UnknownHostException"));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(apiFetch("/api/sync/status?n=5", {
      transport: "native-android",
      laneBackup: { delayMs: 3000 },
    })).rejects.toThrow(/请求失败|failed/i);
  });

  it("原生失败的报错把底层异常留作 cause（失败上报靠它分 DNS / 建连 / 读超时）", async () => {
    const nativeError = new Error("java.net.UnknownHostException: Unable to resolve host");
    vi.spyOn(nativeHttp, "request").mockRejectedValue(nativeError);
    const error = await apiFetch("/api/sync/status?n=7", { transport: "native-android" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^网络请求失败/);
    expect((error as Error).cause).toBe(nativeError);
  });

  it("不带 laneBackup：原生失败不改走 WebView", async () => {
    vi.spyOn(nativeHttp, "request").mockRejectedValue(new Error("UnknownHostException"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(apiFetch("/api/sync/status?n=6", { transport: "native-android" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("原生主路只带 hedge 不带 laneBackup：hedge 不再兼作跨车道备份", async () => {
    vi.spyOn(nativeHttp, "request").mockRejectedValue(new Error("UnknownHostException"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(apiFetch("/api/sync/status?n=9", {
      transport: "native-android",
      hedge: { delayMs: 1500 },
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("WebView 主路在 delayMs 内回：不发原生，outcome 记主路答复", async () => {
    const nativeMock = vi.spyOn(nativeHttp, "request");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: "web" }));
    const outcomes: LaneOutcome[] = [];
    await expect(apiFetch("/api/sync/pull?w=1", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
      onLaneOutcome: (o) => outcomes.push(o),
    })).resolves.toEqual({ ok: "web" });
    expect(nativeMock).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ primary: "web", backupFired: false, servedBy: "web" }]);
  });

  it("WebView 主路挂住超过 delayMs：发原生备份，原生先回则 WebView 被 abort", async () => {
    let webSignal: AbortSignal | null = null;
    let webBody: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      webSignal = (init?.signal as AbortSignal) ?? null;
      webBody = init?.body;
      return new Promise<Response>(() => {});
    });
    const nativeMock = vi.spyOn(nativeHttp, "request").mockResolvedValue(nativeOk({ ok: "native" }));
    const servedBy: string[] = [];
    const outcomes: LaneOutcome[] = [];
    const promise = apiFetch("/api/sync/push?w=2", {
      method: "POST",
      body: JSON.stringify({ requestId: "r-1" }),
      transport: "web",
      laneBackup: { delayMs: 2000 },
      onServedBy: (t) => servedBy.push(t),
      onLaneOutcome: (o) => outcomes.push(o),
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(nativeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ ok: "native" });
    expect(nativeMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      data: JSON.stringify({ requestId: "r-1" }),
    }));
    // 两条车道发的是同一份 body（同一个 requestId）：原生输家晚到只会命中服务端回放
    expect(webBody).toBe(JSON.stringify({ requestId: "r-1" }));
    expect((webSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(servedBy).toEqual(["native-android"]);
    expect(outcomes).toEqual([{ primary: "web", backupFired: true, servedBy: "native-android" }]);
  });

  it("WebView 主路网络错误：不等 delayMs 立即发原生", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const nativeMock = vi.spyOn(nativeHttp, "request").mockResolvedValue(nativeOk({ ok: "native" }));
    await expect(apiFetch("/api/sync/pull?w=3", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
    })).resolves.toEqual({ ok: "native" });
    expect(nativeMock).toHaveBeenCalledTimes(1);
  });

  it("WebView 主路回了 HTTP 错误码：照抛 ApiError，不发原生", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
    const nativeMock = vi.spyOn(nativeHttp, "request");
    const promise = apiFetch("/api/sync/push?w=4", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
    });
    const assertion = expect(promise).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(nativeMock).not.toHaveBeenCalled();
  });

  it("WebView 主路挂住、原生备份回了 HTTP 错误码：那是服务端的答复，立即照抛，不等主路", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    vi.spyOn(nativeHttp, "request").mockResolvedValue({ status: 500, data: { error: "boom" }, headers: {}, url: "" });
    const outcomes: LaneOutcome[] = [];
    let settledAt: number | null = null;
    const promise = apiFetch("/api/sync/pull?w=7", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
      onLaneOutcome: (o) => outcomes.push(o),
    });
    promise.catch(() => {
      settledAt = Date.now();
    });
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).rejects.toMatchObject({ status: 500 });
    expect(settledAt).toBe(startedAt + 2000);
    expect(outcomes).toEqual([{ primary: "web", backupFired: true, servedBy: null }]);
  });

  it("两车道都失败：outcome 只回调一次且 servedBy 为 null", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(nativeHttp, "request").mockRejectedValue(new Error("SocketTimeoutException"));
    const outcomes: LaneOutcome[] = [];
    await expect(apiFetch("/api/sync/pull?w=5", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
      onLaneOutcome: (o) => outcomes.push(o),
    })).rejects.toThrow(/请求失败|failed/i);
    expect(outcomes).toEqual([{ primary: "web", backupFired: true, servedBy: null }]);
  });

  it("非安卓平台带 laneBackup：退回单路 WebView，不碰原生", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    const nativeMock = vi.spyOn(nativeHttp, "request");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(apiFetch("/api/sync/pull?w=6", {
      method: "POST",
      body: "{}",
      transport: "web",
      laneBackup: { delayMs: 2000 },
    })).rejects.toThrow();
    expect(nativeMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// 2026-08-07：桌面版被 CORS 拒时报的是这条兜底文案，而它当时写着「请确认手机能打开服务器」——
// 在电脑上排查同步问题的人被这句直接带偏。fetch reject 分不清「CORS 被拒」和「真连不上」，
// 文案只能把两种都覆盖，那就至少要说对本平台该查什么。
describe("fetch 失败文案按壳分平台", () => {
  // node 桶写法，同 desktop/shell.test.ts：直接在 globalThis 上装/卸一个最小 window，
  // 不用 jsdom 指令也不用 defineProperty（两者都是脏标记，会被挡在 unit-clean 快桶外）。
  // 桌面壳判定走真的 isDesktopShell（读 window.__TAURI_INTERNALS__），不 mock。
  function setDesktopShell(present: boolean) {
    if (present) {
      (globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} };
    } else {
      // biome-ignore lint/performance/noDelete: 测的就是「没有 window 这个全局」的环境；赋 undefined 后 `"window" in globalThis` 仍为 true，桌面壳探测会走另一条分支
      delete (globalThis as Record<string, unknown>).window;
    }
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    setDesktopShell(false);
  });

  afterEach(() => {
    setDesktopShell(false);
  });

  async function failureMessage(): Promise<string> {
    localStorage.setItem("timedata_api_url", "https://example.com");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    return await apiFetch("/api/sync/push", { method: "POST" }).then(
      () => {
        throw new Error("这个请求本该失败");
      },
      (error: Error) => error.message,
    );
  }

  it("桌面壳：点明桌面版来源要被服务端放行，不提手机", async () => {
    setDesktopShell(true);

    const message = await failureMessage();

    expect(message).toContain("http://tauri.localhost");
    expect(message).not.toContain("手机");
  });

  it("手机壳：仍然说手机与 https://localhost", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");

    const message = await failureMessage();

    expect(message).toContain("手机");
    expect(message).toContain("https://localhost");
    expect(message).not.toContain("tauri.localhost");
  });

  it("网页版：既不提手机也不提桌面壳 origin", async () => {
    const message = await failureMessage();

    expect(message).not.toContain("手机");
    expect(message).not.toContain("tauri.localhost");
  });

  // 三条文案都必须带上失败的 URL，否则排查时连打的是哪个地址都看不到
  it("三个平台的文案都带上请求 URL", async () => {
    const web = await failureMessage();
    setDesktopShell(true);
    const desktop = await failureMessage();
    setDesktopShell(false);
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    const mobile = await failureMessage();

    for (const message of [web, desktop, mobile]) {
      expect(message).toContain("https://example.com/api/sync/push");
    }
  });
});
