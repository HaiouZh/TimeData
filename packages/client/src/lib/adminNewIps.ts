// 陌生 IP 提醒 API。独立成文件(不进 adminApi.ts):并行任务在改 adminApi.ts,避免合并冲突。
import { apiFetch } from "./api.ts";

export interface UnacknowledgedNewIp {
  tokenTier: string;
  ip: string;
  firstSeen: string;
  lastSeen: string;
}

export interface UnacknowledgedNewIpsResponse {
  newIps: UnacknowledgedNewIp[];
}

export function fetchUnacknowledgedNewIps(): Promise<UnacknowledgedNewIpsResponse> {
  return apiFetch("/api/admin/request-logs/new-ips");
}

export function acknowledgeNewIp(tokenTier: string, ip: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/admin/request-logs/new-ips/acknowledge", {
    method: "POST",
    body: JSON.stringify({ tokenTier, ip }),
  });
}
