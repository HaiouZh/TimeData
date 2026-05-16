export interface ApiConfig {
  serverUrl: string;
  token: string;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  fetchImpl?: typeof fetch;
}

export async function requestJson(config: ApiConfig, path: string, options: RequestOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${config.serverUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetchImpl(url, {
      method: options.method || "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } };
      }
      if (json && typeof json === "object" && "ok" in json) return json;
      return { ok: false, error: { code: `HTTP_${res.status}`, message: `HTTP ${res.status} ${res.statusText}` } };
    }
    return json;
  } catch (err) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : "Network error" } };
  }
}
