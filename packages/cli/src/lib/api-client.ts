import { validateServerUrl } from "./url.js";

export interface ApiConfig {
  serverUrl: string;
  token: string;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export async function requestJson(config: ApiConfig, path: string, options: RequestOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = validateServerUrl(config.serverUrl);
  if (!baseUrl) {
    return { ok: false, error: { code: "CONFIG_INVALID", message: "Server URL must be http or https" } };
  }
  const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = options.timeoutMs ?? 30000;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const controller = new AbortController();
  const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (res.status === 204) {
      return { ok: false, error: { code: "INVALID_RESPONSE", message: "Server returned no JSON body" } };
    }
    const json = await res.json().catch(() => undefined);
    if (json === undefined) {
      return { ok: false, error: { code: "INVALID_RESPONSE", message: "Server returned invalid JSON" } };
    }
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } };
      }
      if (json && typeof json === "object" && "ok" in json) return json;
      return { ok: false, error: { code: `HTTP_${res.status}`, message: `HTTP ${res.status} ${res.statusText}` } };
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { code: "TIMEOUT", message: "Request timed out" } };
    }
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : "Network error" },
    };
  } finally {
    clearTimeoutImpl(timeout);
  }
}
