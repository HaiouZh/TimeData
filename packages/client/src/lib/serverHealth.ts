import { apiFetch } from "./api.ts";

const DEFAULT_HEALTH_TIMEOUT_MS = 3000;

// 仅探测连通性：/api/health 是本地 DB ping，秒回，不触发任何外部请求。
export async function fetchServerHealth(timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS): Promise<boolean> {
  try {
    await apiFetch("/api/health", { timeoutMs });
    return true;
  } catch {
    return false;
  }
}
