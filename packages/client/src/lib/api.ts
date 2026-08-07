import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { isDesktopShell } from "./desktop/shell.js";
import { CURRENT_BUILD_ID } from "./frontendUpdate.js";
import { messages } from "./messages.ts";
import { safeGetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly details: string,
    public readonly body: unknown,
    public readonly headers: Headers = new Headers(),
  ) {
    super(`API error: ${status} ${statusText}${details ? ` - ${details.slice(0, 200)}` : ""}`);
  }
}

// 同上：拼绝对 asset URL 需要拿到配置的 API base。
export function getApiBase(): string {
  return safeGetItem(STORAGE_KEYS.apiUrl) || "";
}

export function buildApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

// 导出给需要绕开 apiFetch 的 JSON 封装、直接 fetch 二进制内容的场景复用
// （例如日记回顾页的 vault 图片：拿 Bearer token 直连 <img> 会 401，需自行 fetch 转 blob）。
export function getToken(): string {
  return safeGetItem(STORAGE_KEYS.apiToken) || "";
}

function describeFetchFailure(url: string): Error {
  if (isDesktopShell()) {
    return new Error(messages.network.fetchFailed.desktop(url));
  }
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") {
    return new Error(messages.network.fetchFailed.mobile(url));
  }
  return new Error(messages.network.fetchFailed.web(url));
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  /** 对冲：delayMs 内响应头未到并发第二枪，网络错误立即补枪；共 2 枪。仅限幂等请求 + 字符串 body。 */
  hedge?: { delayMs: number };
  /** 显式 Android 原生通道；平台或插件能力不满足时在请求发出前回退 Web fetch。 */
  transport?: "web" | "native-android";
}

const DEFAULT_TIMEOUT_MS = 15_000;
const HEDGE_MAX_ATTEMPTS = 2;
type NativeHttpResponse = Awaited<ReturnType<typeof CapacitorHttp.request>>;
const activeNativeRequests = new Map<string, Promise<NativeHttpResponse>>();

function combineSignals(signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    controller.abort(signal.reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }

  return controller.signal;
}

function nativeResponseDetails(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === null || data === undefined) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

function nativeResponseBody(data: unknown): unknown {
  if (typeof data !== "string") return data ?? null;
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function nativeRequestKey(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): string {
  return JSON.stringify([url, method, headers, body ?? null]);
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    timeoutMs: requestedTimeoutMs,
    hedge,
    transport = "web",
    signal: callerSignal,
    ...fetchOptions
  } = options;
  const url = buildApiUrl(getApiBase(), path);
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // 观测线（只记录不拦截）：让服务端日志能看出来包出自哪个构建，
  // 为 sync.md §5.8「旧客户端清空新列」提供排查依据。服务端不据此拒绝请求。
  headers.set("X-TimeData-Client-Build", CURRENT_BUILD_ID);

  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const totalController = new AbortController();
  const timeoutMs = requestedTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const totalTimer = setTimeout(() => {
    timedOut = true;
    totalController.abort();
  }, timeoutMs);

  const useNativeAndroidTransport =
    transport === "native-android"
    && Capacitor.getPlatform() === "android"
    && Capacitor.isPluginAvailable("CapacitorHttp");

  if (useNativeAndroidTransport) {
    if (fetchOptions.body != null && typeof fetchOptions.body !== "string") {
      clearTimeout(totalTimer);
      throw new TypeError("Native Android transport only supports string request bodies");
    }

    const abortSignal = combineSignals([callerSignal, totalController.signal]);
    if (abortSignal.aborted) {
      clearTimeout(totalTimer);
      throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const nativeHeaders = Object.fromEntries(headers.entries());
    const nativeMethod = fetchOptions.method ?? "GET";
    const nativeBody = typeof fetchOptions.body === "string" ? fetchOptions.body : undefined;
    const requestKey = nativeRequestKey(url, nativeMethod, nativeHeaders, nativeBody);
    let abortListener: (() => void) | null = null;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectFromSignal = () => {
        reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (abortSignal.aborted) {
        rejectFromSignal();
        return;
      }
      abortListener = rejectFromSignal;
      abortSignal.addEventListener("abort", rejectFromSignal, { once: true });
    });

    try {
      let nativeRequest = activeNativeRequests.get(requestKey);
      if (!nativeRequest) {
        nativeRequest = CapacitorHttp.request({
          url,
          method: nativeMethod,
          headers: nativeHeaders,
          ...(nativeBody === undefined ? {} : { data: nativeBody }),
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
        activeNativeRequests.set(requestKey, nativeRequest);
        void nativeRequest.then(
          () => {
            if (activeNativeRequests.get(requestKey) === nativeRequest) activeNativeRequests.delete(requestKey);
          },
          () => {
            if (activeNativeRequests.get(requestKey) === nativeRequest) activeNativeRequests.delete(requestKey);
          },
        );
      }
      // CapacitorHttp 没有逐请求 cancel；abort/timeout 只停止 JS 等待，底层请求可能继续完成。
      const nativeResponse = await Promise.race([
        nativeRequest,
        abortPromise,
      ]);
      const responseHeaders = new Headers(nativeResponse.headers);
      if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
        const body = nativeResponseBody(nativeResponse.data);
        throw new ApiError(
          nativeResponse.status,
          "",
          nativeResponseDetails(nativeResponse.data),
          body,
          responseHeaders,
        );
      }
      if (nativeResponse.status === 204 || nativeResponse.data === "" || nativeResponse.data === undefined) {
        return undefined as T;
      }
      // CapacitorHttp 已按响应 Content-Type 解码 application/json；不能再次 JSON.parse，
      // 否则原生层返回的 JSON 字符串值会被误判为非法 JSON。
      return nativeResponse.data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new Error(messages.network.timeout(timeoutMs, url));
      if (callerSignal?.aborted) throw error;
      if ((error as Error).name === "AbortError") throw error;
      throw describeFetchFailure(url);
    } finally {
      clearTimeout(totalTimer);
      if (abortListener) abortSignal.removeEventListener("abort", abortListener);
    }
  }

  // 竞速多枪：先到的响应头定胜负，输家 abort；HTTP 状态错误算"有响应"，照走下方 ApiError 路径。
  const raceAttempts = (): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const maxAttempts = hedge ? HEDGE_MAX_ATTEMPTS : 1;
      const controllers: AbortController[] = [];
      let launched = 0;
      let failures = 0;
      let settled = false;
      let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        finish();
      };

      const launch = (): void => {
        if (settled || launched >= maxAttempts) return;
        launched += 1;
        const controller = new AbortController();
        controllers.push(controller);
        fetch(url, {
          ...fetchOptions,
          headers,
          signal: combineSignals([callerSignal, totalController.signal, controller.signal]),
        }).then(
          (response) => {
            settle(() => {
              for (const other of controllers) {
                if (other !== controller) other.abort();
              }
              resolve(response);
            });
          },
          (error: unknown) => {
            failures += 1;
            if (settled) return;
            if (!timedOut && !callerSignal?.aborted && launched < maxAttempts) {
              launch(); // 快重试：不等 TCP 重传长尾
              return;
            }
            if (failures >= launched) settle(() => reject(error));
          },
        );
      };

      launch();
      if (hedge) {
        hedgeTimer = setTimeout(launch, hedge.delayMs);
      }
    });

  let res: Response;
  try {
    res = await raceAttempts();
  } catch (error) {
    if (timedOut) {
      throw new Error(messages.network.timeout(timeoutMs, url));
    }
    if (callerSignal?.aborted) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw error;
    }
    throw describeFetchFailure(url);
  } finally {
    clearTimeout(totalTimer);
  }

  if (!res.ok) {
    let details = "";
    let body: unknown = null;
    try {
      details = await res.text();
      body = details ? JSON.parse(details) : null;
    } catch {
      body = null;
    }
    throw new ApiError(res.status, res.statusText, details, body, new Headers(res.headers));
  }
  const bodyText = await res.text();
  if (!bodyText) {
    return undefined as T;
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch (error) {
    throw new Error(messages.network.invalidJson(url, bodyText.slice(0, 200)), { cause: error });
  }
}
