export type SyncStreamListener = (latestSeq: number | null) => void;

const listeners = new Set<SyncStreamListener>();

export function addSyncStreamListener(listener: SyncStreamListener): void {
  listeners.add(listener);
}

export function removeSyncStreamListener(listener: SyncStreamListener): void {
  listeners.delete(listener);
}

export function notifySyncChange(latestSeq: number | null): void {
  for (const listener of listeners) {
    try {
      listener(latestSeq);
    } catch (error) {
      console.error("[sync/stream] listener failed:", (error as Error).message);
    }
  }
}

export function syncStreamListenerCount(): number {
  return listeners.size;
}
