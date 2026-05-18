import { messages } from "./messages.ts";
import { safeGetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly details: string,
    public readonly body: unknown,
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
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs: requestedTimeoutMs, signal: _signal, ...fetchOptions } = options;
  const url = buildApiUrl(getApiBase(), path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutMs = requestedTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(messages.network.timeout(timeoutMs, url));
    }
    throw describeFetchFailure(url);
  } finally {
    clearTimeout(timer);
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
    throw new ApiError(res.status, res.statusText, details, body);
  }
  const bodyText = await res.text();
  if (!bodyText) {
    return undefined as T;
  }
  return JSON.parse(bodyText) as T;
}
