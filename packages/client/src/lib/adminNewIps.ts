// 陌生来源提醒 API。独立成文件(不进 adminApi.ts):并行任务在改 adminApi.ts,避免合并冲突。
import { apiFetch } from "./api.ts";

export interface UnacknowledgedNewIp {
  tokenTier: string;
  scopeKey: string;
  country: string | null;
  city: string | null;
  asnOrg: string | null;
  lastIp: string | null;
  firstSeen: string;
  lastSeen: string;
}

/** 归属地数据源各自是否就绪。缺哪个决定收敛退化到哪一档,所以分开报告。 */
export interface GeoipReadiness {
  city: boolean;
  asn: boolean;
  /** 中国段表。随镜像发布,为 false 说明构建或镜像有问题。老服务端不返回此字段。 */
  chinaTable?: boolean;
}

export interface UnacknowledgedNewIpsResponse {
  newIps: UnacknowledgedNewIp[];
  geoip?: GeoipReadiness;
}

export function fetchUnacknowledgedNewIps(): Promise<UnacknowledgedNewIpsResponse> {
  return apiFetch("/api/admin/request-logs/new-ips");
}

export function acknowledgeNewIp(tokenTier: string, scopeKey: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/admin/request-logs/new-ips/acknowledge", {
    method: "POST",
    body: JSON.stringify({ tokenTier, scopeKey }),
  });
}
