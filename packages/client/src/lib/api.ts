import { Capacitor, CapacitorHttp, type HttpOptions } from "@capacitor/core";
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

// cause 留住底层异常：原生通道的 Java 异常名是分辨 DNS / 建连 / 读超时的唯一线索（失败轮上报会带出）。
function describeFetchFailure(url: string, cause?: unknown): Error {
  const options = cause === undefined ? undefined : { cause };
  if (isDesktopShell()) {
    return new Error(messages.network.fetchFailed.desktop(url), options);
  }
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") {
    return new Error(messages.network.fetchFailed.mobile(url), options);
  }
  return new Error(messages.network.fetchFailed.web(url), options);
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  /**
   * 对冲：delayMs 内响应头未到并发第二枪，网络错误立即补枪；共 2 枪。仅限幂等请求 + 字符串 body。
   * 同源两枪走同一条 HTTP/2 连接，那条连接卡住时两枪一起卡（2026-10-13 实测），换连接要用 laneBackup。
   */
  hedge?: { delayMs: number };
  /** 请求主路；`native-android` 在平台或插件能力不满足时于请求发出前回退 Web fetch。 */
  transport?: ApiTransport;
  /**
   * 安卓双车道：主路（transport）之外用另一条车道作备份——主路网络失败立即发、delayMs 内没回也发，先回者胜。
   * 非安卓或原生插件不可用时忽略，退回单路 Web。仅限幂等请求 + 字符串 body。见 ADR 0038。
   */
  laneBackup?: { delayMs: number };
  /** 实际由哪条通道答复（成功时回调一次）。 */
  onServedBy?: (transport: ApiTransport) => void;
  /** 双车道竞速收尾时回调一次（成功或失败都回调）。 */
  onLaneOutcome?: (outcome: LaneOutcome) => void;
}

export type ApiTransport = "web" | "native-android";

export interface LaneOutcome {
  primary: ApiTransport;
  backupFired: boolean;
  /** 实际答复的车道；两路都失败为 null。 */
  servedBy: ApiTransport | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const HEDGE_MAX_ATTEMPTS = 2;
type NativeHttpResponse = Awaited<ReturnType<typeof CapacitorHttp.request>>;
const activeNativeRequests = new Map<string, Promise<NativeHttpResponse>>();

/** 测试缝：CapacitorHttp 是插件 Proxy，vi.spyOn 挂不上；vi.mock 又会把测试文件踢出快桶。 */
export const nativeHttp = {
  request: (options: HttpOptions): Promise<NativeHttpResponse> => CapacitorHttp.request(options),
};

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

interface RequestContext {
  url: string;
  headers: Headers;
  fetchOptions: RequestInit;
  timeoutMs: number;
  callerSignal: AbortSignal | null | undefined;
  totalSignal: AbortSignal;
  isTimedOut: () => boolean;
  clearTotalTimer: () => void;
}

// 「这条通道没连上」而不是「服务端答复了 / 调用方放弃了 / 总时限到了」——只有前者值得换通道再试。
function isTransportFailure(error: unknown, ctx: RequestContext): boolean {
  if (error instanceof ApiError) return false;
  if (ctx.isTimedOut() || ctx.callerSignal?.aborted) return false;
  return (error as Error | null)?.name !== "AbortError";
}

async function nativeAndroidFetch<T>(ctx: RequestContext): Promise<T> {
  const { url, headers, fetchOptions, timeoutMs } = ctx;
  const abortSignal = combineSignals([ctx.callerSignal, ctx.totalSignal]);
  if (abortSignal.aborted) {
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
      nativeRequest = nativeHttp.request({
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
    if (ctx.isTimedOut()) throw new Error(messages.network.timeout(timeoutMs, url));
    if (ctx.callerSignal?.aborted) throw error;
    if ((error as Error).name === "AbortError") throw error;
    throw describeFetchFailure(url, error);
  } finally {
    if (abortListener) abortSignal.removeEventListener("abort", abortListener);
  }
}

async function webFetch<T>(
  ctx: RequestContext,
  hedge: { delayMs: number } | undefined,
  raceSignal?: AbortSignal,
): Promise<T> {
  const { url, headers, fetchOptions, callerSignal, totalSignal } = ctx;
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
          signal: combineSignals([callerSignal, totalSignal, raceSignal, controller.signal]),
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
            if (!ctx.isTimedOut() && !callerSignal?.aborted && !raceSignal?.aborted && launched < maxAttempts) {
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
    if (ctx.isTimedOut()) {
      throw new Error(messages.network.timeout(ctx.timeoutMs, url));
    }
    if (callerSignal?.aborted || raceSignal?.aborted) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw error;
    }
    throw describeFetchFailure(url, error);
  }
  // 响应头到了才停总计时器，读 body 不受它约束（与改动前一致）。竞速里的车道不停：
  // 另一条可能还挂着，总时限是它唯一的 JS 侧上限，由 apiFetch 收尾统一清。
  if (!raceSignal) ctx.clearTotalTimer();

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

// 2026-10-10：原生（HttpURLConnection）连不上时 WebView 是通的；2026-10-13：WebView 那条 HTTP/2 连接卡住时
// 原生是通的。两条车道连接池互不相干，一条卡住就换另一条：主路网络失败立即、delayMs 内没回到点也发备份，
// 先回者胜。原生输家没法取消（见 nativeAndroidFetch），只是不再等它；WebView 输家被 abort。
function raceLanes<T>(
  ctx: RequestContext,
  primary: ApiTransport,
  delayMs: number,
  onServedBy: ((transport: ApiTransport) => void) | undefined,
  onLaneOutcome: ((outcome: LaneOutcome) => void) | undefined,
): Promise<T> {
  const backup: ApiTransport = primary === "web" ? "native-android" : "web";
  return new Promise<T>((resolve, reject) => {
    const webRace = new AbortController();
    let settled = false;
    let backupFired = false;
    let pending = 1;
    const runLane = (lane: ApiTransport): Promise<T> =>
      lane === "web" ? webFetch<T>(ctx, undefined, webRace.signal) : nativeAndroidFetch<T>(ctx);

    const finish = (servedBy: ApiTransport | null): void => {
      settled = true;
      clearTimeout(backupTimer);
      webRace.abort();
      onLaneOutcome?.({ primary, backupFired, servedBy });
    };
    const win = (lane: ApiTransport, value: T): void => {
      if (settled) return;
      finish(lane);
      onServedBy?.(lane);
      resolve(value);
    };
    // final=服务端已答复 / 调用方放弃 / 总时限到：不必再等另一条。否则等两条都输完才报错。
    const lose = (error: unknown, final: boolean): void => {
      pending -= 1;
      if (settled) return;
      if (final || pending === 0) {
        finish(null);
        reject(error);
      }
    };
    const startBackup = (): void => {
      if (settled || backupFired) return;
      backupFired = true;
      pending += 1;
      runLane(backup).then(
        (value) => win(backup, value),
        (error: unknown) => lose(error, !isTransportFailure(error, ctx)),
      );
    };

    const backupTimer = setTimeout(startBackup, delayMs);
    runLane(primary).then(
      (value) => win(primary, value),
      (error: unknown) => {
        const transportFailure = isTransportFailure(error, ctx);
        if (transportFailure) startBackup();
        lose(error, !transportFailure);
      },
    );
  });
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    timeoutMs: requestedTimeoutMs,
    hedge,
    transport = "web",
    laneBackup,
    onServedBy,
    onLaneOutcome,
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
  const ctx: RequestContext = {
    url,
    headers,
    fetchOptions,
    timeoutMs,
    callerSignal,
    totalSignal: totalController.signal,
    isTimedOut: () => timedOut,
    clearTotalTimer: () => clearTimeout(totalTimer),
  };

  const nativeAvailable = Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("CapacitorHttp");
  const assertStringBody = (): void => {
    if (fetchOptions.body != null && typeof fetchOptions.body !== "string") {
      throw new TypeError("Native Android transport only supports string request bodies");
    }
  };

  try {
    if (laneBackup && nativeAvailable) {
      assertStringBody();
      return await raceLanes<T>(ctx, transport, laneBackup.delayMs, onServedBy, onLaneOutcome);
    }
    if (transport !== "native-android" || !nativeAvailable) {
      const result = await webFetch<T>(ctx, hedge);
      onServedBy?.("web");
      return result;
    }
    assertStringBody();
    const result = await nativeAndroidFetch<T>(ctx);
    onServedBy?.("native-android");
    return result;
  } finally {
    clearTimeout(totalTimer);
  }
}
