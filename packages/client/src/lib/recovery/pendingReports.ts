import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";

export interface PendingReport {
  action: string;
  detail?: string;
  record_count?: number;
}

/** 攒多少条封顶。跨太平洋链路上同步不一定马上成功，但观测数据不值得无限堆。 */
export const PENDING_REPORTS_MAX = 5;

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

export function stashPendingReport(entry: PendingReport, kv: RecoveryKV = defaultRecoveryKV): void {
  const next = [...readPendingReports(kv), entry].slice(-PENDING_REPORTS_MAX);
  kv.set(STORAGE_KEYS.pendingReports, JSON.stringify(next));
}

export function clearPendingReports(kv: RecoveryKV = defaultRecoveryKV): void {
  kv.remove(STORAGE_KEYS.pendingReports);
}

/**
 * 把攒着的埋点并进本次上报，**发成功才清空**。
 *
 * 顺序本身就是契约：清空一旦挪到 `send` 之前（或塞进 finally），请求失败时这批记录就凭空消失了，
 * 而调用点在 `catch {}` 里吞掉一切异常、看不出任何症状。抽成独立函数只为一件事——
 * 让这个顺序能被测试锁住（直接测 `reportToServer` 要 mock apiFetch，那是脏标记，进不了干净桶）。
 *
 * `send` 抛错时原样抛给调用方：要不要吞由调用方决定，这里只保证记录不丢。
 */
export async function sendWithPending(
  logs: PendingReport[],
  send: (all: PendingReport[]) => Promise<void>,
  kv: RecoveryKV = defaultRecoveryKV,
): Promise<void> {
  const pending = readPendingReports(kv);
  await send(pending.length > 0 ? [...pending, ...logs] : logs);
  if (pending.length > 0) clearPendingReports(kv);
}
