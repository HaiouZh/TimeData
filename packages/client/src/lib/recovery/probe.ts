import { STORAGE_KEYS } from "../storageKeys.js";
import { buildColdStartReport } from "./coldStart.js";
import { defaultRecoveryKV } from "./kv.js";
import { stashPendingReport } from "./pendingReports.js";
import { attributeReload, consumeTombstone, readTombstone } from "./reloadAttribution.js";

let firstPaintRecorded = false;

function navigationEntry(): PerformanceNavigationTiming | null {
  try {
    const entries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * React 首帧落地时调一次（幂等）。这里同时把整条冷启动记录攒进待发送队列——
 * 首帧是本轮能拿到的最后一个分段点，此刻信息才齐。
 *
 * 埋点**不额外开请求**：跨太平洋一个 RTT 就是几百毫秒，观测不配为此多花一个。
 * 记录搭下一次同步上报的车（见 sync/engine.ts 的 reportToServer）。
 */
export function markFirstPaint(): void {
  if (firstPaintRecorded) return;
  firstPaintRecorded = true;

  try {
    const nav = navigationEntry();
    if (!nav) return;

    const cause = attributeReload(nav.type, readTombstone(), Date.now());
    consumeTombstone();

    const report = buildColdStartReport({
      cause,
      domContentLoadedMs: nav.domContentLoadedEventEnd,
      firstPaintMs: performance.now(),
    });
    stashPendingReport(report);
    // 设置页那行要显示的最近一次，与待发送队列分开存：队列会被发走清空，显示不该跟着消失。
    defaultRecoveryKV.set(STORAGE_KEYS.lastColdStart, report.detail);
  } catch {
    // 观测失败绝不能影响启动路径
  }
}

/** 供设置页显示。解析失败一律当没有。 */
export function readLastColdStart(): { cause: string; parseMs: number; mountMs: number | null } | null {
  const raw = defaultRecoveryKV.get(STORAGE_KEYS.lastColdStart);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { cause?: unknown; parseMs?: unknown; mountMs?: unknown };
    if (typeof parsed.cause !== "string" || typeof parsed.parseMs !== "number") return null;
    const mountMs = typeof parsed.mountMs === "number" ? parsed.mountMs : null;
    return { cause: parsed.cause, parseMs: parsed.parseMs, mountMs };
  } catch {
    return null;
  }
}
