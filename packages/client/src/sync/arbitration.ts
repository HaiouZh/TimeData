import type { SyncChange } from "@timedata/shared";
import { db, type PendingArbitration } from "../db/index.ts";

/** 记一条待裁决冲突。同一 recordId 覆盖写：一条记录同时最多一个待裁决。 */
export async function recordPendingArbitration(
  change: SyncChange,
  syncLogIds: string[],
  now: Date = new Date(),
): Promise<void> {
  await db.pendingArbitrations.put({
    recordId: change.recordId,
    tableName: change.tableName,
    action: change.action,
    payloadJson: JSON.stringify(change.data ?? null),
    syncLogIds,
    rejectedAt: now.toISOString(),
  });
}

export async function listPendingArbitrations(): Promise<PendingArbitration[]> {
  return db.pendingArbitrations.toArray();
}

export async function clearPendingArbitration(recordId: string): Promise<void> {
  await db.pendingArbitrations.delete(recordId);
}
