import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export type SyncPhaseName = "health" | "status" | "backup" | "push" | "pull" | "report";

export interface PhaseRecorder {
  time<T>(phase: SyncPhaseName, fn: () => Promise<T>): Promise<T>; // 异常照抛，仍记耗时
  readonly phases: Partial<Record<SyncPhaseName, number>>; // 整数 ms
}

export function createPhaseRecorder(now: () => number = Date.now): PhaseRecorder {
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

export function getSyncTimings(kv: TimingsKV = defaultKV): SyncTimingEntry[] {
  const raw = kv.get(STORAGE_KEYS.syncPhaseTimings);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncTimingEntry[]) : [];
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
