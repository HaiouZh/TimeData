/**
 * 同步请求的资源计时缓存（ios-instant-open 阶段1 design §3.6）。
 *
 * 用 PerformanceObserver 在内存里留最近一次 status / pull / push 的条目，**不依赖** `performance.getEntriesByType`：
 * 后者受 250 条缓冲上限约束，长驻页面（生产见过 12 小时）早已写满，新条目不再入列，读到的永远是旧的或读不到。
 */

export interface NetTiming {
  /** connectEnd - connectStart，含 TLS。 */
  connectMs: number | null;
  /** responseStart - requestStart。 */
  ttfbMs: number | null;
  /** responseEnd - responseStart。 */
  xferMs: number | null;
  /** connectStart === connectEnd：连接复用。 */
  reused: boolean | null;
}

export type SyncPathKey = "status" | "pull" | "push";

export type ResourceEntryLike = Pick<
  PerformanceResourceTiming,
  "name" | "startTime" | "connectStart" | "connectEnd" | "requestStart" | "responseStart" | "responseEnd" | "nextHopProtocol"
>;

const latest = new Map<SyncPathKey, ResourceEntryLike>();
let protocol: string | undefined;
let installed = false;

function syncPathKey(url: string): SyncPathKey | null {
  if (url.includes("/api/sync/status")) return "status";
  if (url.includes("/api/sync/pull")) return "pull";
  if (url.includes("/api/sync/push")) return "push";
  return null;
}

export function recordResourceEntry(entry: ResourceEntryLike): void {
  if (!entry.name.includes("/api/sync/")) return;
  if (entry.nextHopProtocol) protocol = entry.nextHopProtocol;
  const key = syncPathKey(entry.name);
  if (key) latest.set(key, entry);
}

export function netTimingOf(entry: ResourceEntryLike | undefined): NetTiming | null {
  if (!entry) return null;
  // 跨域且服务端没发 Timing-Allow-Origin 时这些属性被浏览器置 0：一律记 null，不拿 0 冒充。
  if (entry.requestStart === 0 && entry.responseStart === 0) {
    return { connectMs: null, ttfbMs: null, xferMs: null, reused: null };
  }
  return {
    connectMs: Math.max(0, Math.round(entry.connectEnd - entry.connectStart)),
    ttfbMs: Math.max(0, Math.round(entry.responseStart - entry.requestStart)),
    xferMs: Math.max(0, Math.round(entry.responseEnd - entry.responseStart)),
    reused: entry.connectStart === entry.connectEnd,
  };
}

/** 最近一次该路径请求、且发起不早于 `sinceMs`（performance.now 时基）时的细分；否则 null。 */
export function latestNetTimingSince(key: SyncPathKey, sinceMs: number): NetTiming | null {
  const entry = latest.get(key);
  if (!entry || entry.startTime < sinceMs) return null;
  return netTimingOf(entry);
}

/**
 * 本次打开的首个同步读请求（status 或 pull，取发起最早者）的细分。有游标时回前台只发一次增量 pull、
 * 不再发 status——只看 status 会让 open_session.net 整列变空，看起来像服务端没发 Timing-Allow-Origin。
 */
export function syncNetTimingSince(sinceMs: number): NetTiming | null {
  const candidates = (["status", "pull"] as const)
    .map((key) => latest.get(key))
    .filter((entry): entry is ResourceEntryLike => entry !== undefined && entry.startTime >= sinceMs)
    .sort((a, b) => a.startTime - b.startTime);
  return netTimingOf(candidates[0]);
}

export function latestSyncProtocol(): string | undefined {
  return protocol;
}

export function installResourceTimingCache(
  scope: { PerformanceObserver?: typeof PerformanceObserver } = globalThis,
): boolean {
  if (installed) return false;
  const Observer = scope.PerformanceObserver;
  if (typeof Observer !== "function") return false;
  try {
    const observer = new Observer((list) => {
      for (const item of list.getEntries()) recordResourceEntry(item as PerformanceResourceTiming);
    });
    observer.observe({ type: "resource", buffered: true });
    installed = true;
    return true;
  } catch {
    return false;
  }
}

/** 仅供测试。 */
export function resetResourceTimingCache(): void {
  latest.clear();
  protocol = undefined;
  installed = false;
}
