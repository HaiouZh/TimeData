import type { SyncChange, SyncStreamBump } from "@timedata/shared";

export type SyncStreamListener = (bump: SyncStreamBump) => void;

const listeners = new Set<SyncStreamListener>();

export function addSyncStreamListener(listener: SyncStreamListener): void {
  listeners.add(listener);
}

export function removeSyncStreamListener(listener: SyncStreamListener): void {
  listeners.delete(listener);
}

// 载荷可选：只有 /api/sync/push 构造（见 sync.ts buildBumpPayload），其余写路径纯 bump。
export function notifySyncChange(latestSeq: number | null, payload?: { fromSeq: number; changes: SyncChange[] }): void {
  const bump: SyncStreamBump = payload ? { latestSeq, fromSeq: payload.fromSeq, changes: payload.changes } : { latestSeq };
  for (const listener of listeners) {
    try {
      listener(bump);
    } catch (error) {
      console.error("[sync/stream] listener failed:", (error as Error).message);
    }
  }
}

export function syncStreamListenerCount(): number {
  return listeners.size;
}
