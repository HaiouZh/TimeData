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

function getApiBase(): string {
  return safeGetItem(STORAGE_KEYS.apiUrl) || "";
}

export function buildApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function getToken(): string {
  return safeGetItem(STORAGE_KEYS.apiToken) || "";
}

function describeFetchFailure(url: string): Error {
  return new Error(messages.network.fetchFailed(url));
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  /** 对冲：delayMs 内响应头未到并发第二枪，网络错误立即补枪；共 2 枪。仅限幂等请求 + 字符串 body。 */
  hedge?: { delayMs: number };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const HEDGE_MAX_ATTEMPTS = 2;

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

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs: requestedTimeoutMs, hedge, signal: callerSignal, ...fetchOptions } = options;
  const url = buildApiUrl(getApiBase(), path);
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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
