import type { AdminRequestLogOutcome, AdminRequestLogTokenTier } from "@timedata/shared";
import type { MiddlewareHandler } from "hono";
import { deviceLabelFromHeaders, getClientIpFromHeaders, normalizeClientHint } from "../lib/requestMeta.js";
import { pruneRequestLogs, recordRequestLog } from "../lib/requestLog.js";
import { checkAndRecordIp } from "../lib/knownIps.js";

// 容器健康检查每 30 秒打一次,成功记录纯属噪音:2026-07-30 生产上 5000 行日志里
// 4390 条是它(88%),真正有用的日志被挤到只剩 40 小时可回溯。成功的探活整段跳过——
// 连带省掉 pruneRequestLogs 那次全表扫描。异常仍然记录,探活挂了必须看得见。
const HEALTH_PATH = "/api/health";

function isHealthProbeToSkip(path: string, status: number): boolean {
  return path === HEALTH_PATH && status < 400;
}

function outcomeForStatus(status: number): AdminRequestLogOutcome {
  if (status < 400) return "ok";
  if (status === 401) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "client_error";
}

export function requestAudit(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();

    try {
      await next();
    } finally {
      const status = c.res.status || 200;
      try {
        const path = new URL(c.req.url).pathname;
        if (!isHealthProbeToSkip(path, status)) {
          const tokenTier = (c.get("tokenTier") as AdminRequestLogTokenTier | undefined) ?? "unknown";
          const ip = getClientIpFromHeaders(c.req.raw.headers);
          // 陌生 IP 检测失败不影响主请求与日志写入,对齐本文件既有容错风格。
          let isNewIp = false;
          try {
            isNewIp = checkAndRecordIp(tokenTier, ip, new Date(started).toISOString());
          } catch (error) {
            console.warn("[request-audit] known-ip check failed:", error);
          }
          recordRequestLog({
            timestamp: new Date(started).toISOString(),
            method: c.req.method,
            path,
            status,
            outcome: outcomeForStatus(status),
            tokenTier,
            ip,
            userAgent: c.req.header("User-Agent")?.slice(0, 500) ?? null,
            clientHint: normalizeClientHint(c.req.header("X-TimeData-Client") ?? null),
            deviceLabel: deviceLabelFromHeaders(c.req.raw.headers),
            durationMs: Math.max(0, Date.now() - started),
            isNewIp,
          });
          pruneRequestLogs();
        }
      } catch (error) {
        console.warn("[request-audit] write failed:", error);
      }
    }
  };
}
