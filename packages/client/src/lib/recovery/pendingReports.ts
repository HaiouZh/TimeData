import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";

export interface PendingReport {
  action: string;
  detail?: string;
  record_count?: number;
}

/**
 * 攒多少条封顶。每次打开记一条 open_session（ios-instant-open 阶段1 design §4），5 条会把早记录挤掉；
 * 观测数据仍不值得无限堆。
 */
export const PENDING_REPORTS_MAX = 30;

/** 服务端 SyncLogEntrySchema 的 detail 上限（server/src/routes/syncLog.ts）。超了整批 400，队列会被毒死。 */
export const SYNC_LOG_DETAIL_MAX = 1000;

/** 服务端单批条数上限（同上 `.max(100)`）。 */
export const SYNC_LOG_BATCH_MAX = 100;

function isReport(value: unknown): value is PendingReport {
  return typeof value === "object" && value !== null && typeof (value as PendingReport).action === "string";
}

export function readPendingReports(kv: RecoveryKV = defaultRecoveryKV): PendingReport[] {
  const raw = kv.get(STORAGE_KEYS.pendingReports);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // 逐元素校验：坏元素被丢弃而非传染整份，同 phaseTimings 的做法。
    return Array.isArray(parsed) ? parsed.filter(isReport) : [];
  } catch {
    return [];
  }
}

function writePendingReports(reports: PendingReport[], kv: RecoveryKV): void {
  if (reports.length === 0) kv.remove(STORAGE_KEYS.pendingReports);
  else kv.set(STORAGE_KEYS.pendingReports, JSON.stringify(reports));
}

function bumpDropped(count: number, kv: RecoveryKV): void {
  if (count <= 0) return;
  const parsed = Number(kv.get(STORAGE_KEYS.droppedReports) ?? "0");
  const current = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  kv.set(STORAGE_KEYS.droppedReports, String(current + count));
}

/** 读出自上次读取以来丢失的上报条数（超长拒收 + 队列满挤出）并清零。由 open_session 以 `dropped` 带出。 */
export function takeDroppedReportCount(kv: RecoveryKV = defaultRecoveryKV): number {
  const parsed = Number(kv.get(STORAGE_KEYS.droppedReports) ?? "0");
  kv.remove(STORAGE_KEYS.droppedReports);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** 攒一条。`detail` 超过服务端上限时拒收并返回 false——放进去只会让整批 400、队列被毒死直到被挤出。 */
export function stashPendingReport(entry: PendingReport, kv: RecoveryKV = defaultRecoveryKV): boolean {
  if (entry.detail !== undefined && entry.detail.length > SYNC_LOG_DETAIL_MAX) {
    bumpDropped(1, kv);
    return false;
  }
  const all = [...readPendingReports(kv), entry];
  bumpDropped(all.length - PENDING_REPORTS_MAX, kv);
  writePendingReports(all.slice(-PENDING_REPORTS_MAX), kv);
  return true;
}

export function clearPendingReports(kv: RecoveryKV = defaultRecoveryKV): void {
  kv.remove(STORAGE_KEYS.pendingReports);
}

/**
 * 从队列里删掉本次发出去的那些，**按序列化内容计次匹配**：发送途中新 stash 的条目不在 `sent` 里，原样保留。
 * 旧实现「成功后整个清空」会把途中新增的一起清掉。
 */
export function removeSentReports(sent: PendingReport[], kv: RecoveryKV = defaultRecoveryKV): void {
  const remaining = new Map<string, number>();
  for (const report of sent) {
    const key = JSON.stringify(report);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const kept = readPendingReports(kv).filter((report) => {
    const key = JSON.stringify(report);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
  writePendingReports(kept, kv);
}

/** 一次带队列的发送是否在途。同一同步轮里 bump / push / pull 三处几乎同时 fire-and-forget 调 reportToServer。 */
let queuedSendInFlight = false;

/**
 * 把攒着的埋点并进本次上报，**发成功才删、且只删发出去的那几条**。
 *
 * 顺序本身就是契约：删除一旦挪到 `send` 之前（或塞进 finally），请求失败时这批记录就凭空消失了，
 * 而调用点在 `catch {}` 里吞掉一切异常、看不出任何症状。
 *
 * - 已有一次带队列的发送在途时，后来的调用只发自己的日志：否则各自读到同一份队列、服务端收到两份。
 * - 队列 + 本轮日志超过服务端单批上限时，只带得下的那部分队列条目随车，其余留着下次再带。
 *
 * `send` 抛错时原样抛给调用方：要不要吞由调用方决定，这里只保证记录不丢。
 */
export async function sendWithPending(
  logs: PendingReport[],
  send: (all: PendingReport[]) => Promise<void>,
  kv: RecoveryKV = defaultRecoveryKV,
): Promise<void> {
  if (queuedSendInFlight) {
    if (logs.length > 0) await send(logs);
    return;
  }
  const pending = readPendingReports(kv).slice(0, Math.max(0, SYNC_LOG_BATCH_MAX - logs.length));
  if (pending.length === 0) {
    await send(logs);
    return;
  }
  queuedSendInFlight = true;
  try {
    await send([...pending, ...logs]);
    removeSentReports(pending, kv);
  } finally {
    queuedSendInFlight = false;
  }
}
