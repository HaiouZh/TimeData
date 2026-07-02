import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export type SyncPhaseName = "health" | "status" | "push" | "pull" | "report";

export interface PhaseRecorder {
  time<T>(phase: SyncPhaseName, fn: () => Promise<T>): Promise<T>; // 异常照抛，仍记耗时
  readonly phases: Partial<Record<SyncPhaseName, number>>; // 整数 ms
}

export function createPhaseRecorder(now: () => number = () => performance.now()): PhaseRecorder {
  const phases: Partial<Record<SyncPhaseName, number>> = {};
  return {
    phases,
    async time<T>(phase: SyncPhaseName, fn: () => Promise<T>): Promise<T> {
      const start = now();
      try {
        return await fn();
      } finally {
        phases[phase] = Math.round(now() - start);
      }
    },
  };
}

export type SyncTimingOutcome = "identical" | "pushed" | "pull_only" | "error";

export interface SyncTimingEntry {
  at: string; // UTC ISO
  outcome: SyncTimingOutcome;
  totalMs: number;
  phases: Partial<Record<SyncPhaseName, number>>;
  unsyncedAtStart?: number;
  visibility?: string; // document.visibilityState
}

export interface TimingsKV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const defaultKV: TimingsKV = { get: safeGetItem, set: safeSetItem };

export const SYNC_TIMINGS_MAX = 20;

export function recordSyncTiming(entry: SyncTimingEntry, kv: TimingsKV = defaultKV): void {
  const existing = getSyncTimings(kv);
  const next = [entry, ...existing].slice(0, SYNC_TIMINGS_MAX); // 环形：最新在前，超出裁尾
  kv.set(STORAGE_KEYS.syncPhaseTimings, JSON.stringify(next));
}

// 逐元素 shape 校验：坏元素被丢弃而非传染 UI。phases 允许带未知键（历史 localStorage
// 数据可能带 health/backup/report 等旧阶段名），未知键的值只要是有限 number 即合法。
function isValidTimingEntry(value: unknown): value is SyncTimingEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.at !== "string" || typeof entry.outcome !== "string") return false;
  if (typeof entry.totalMs !== "number" || !Number.isFinite(entry.totalMs)) return false;
  if (typeof entry.phases !== "object" || entry.phases === null) return false;
  return Object.values(entry.phases).every((ms) => typeof ms === "number" && Number.isFinite(ms));
}

export function getSyncTimings(kv: TimingsKV = defaultKV): SyncTimingEntry[] {
  const raw = kv.get(STORAGE_KEYS.syncPhaseTimings);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidTimingEntry) : [];
  } catch {
    return [];
  }
}

// 最近邻 rank 法：sorted[ceil(q*n)-1]。
function nearestRank(sorted: number[], q: number): number {
  const index = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.min(index, sorted.length - 1)];
}

export function timingTotalsPercentiles(
  entries: SyncTimingEntry[],
): { p50: number; p95: number } | null {
  if (entries.length < 2) return null;
  const sorted = entries.map((e) => e.totalMs).sort((a, b) => a - b);
  return { p50: nearestRank(sorted, 0.5), p95: nearestRank(sorted, 0.95) };
}
