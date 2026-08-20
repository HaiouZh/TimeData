import type { SyncChange } from "@timedata/shared";
import { db, type PendingArbitration } from "../db/index.ts";

export function isImplicitDeleteChange(change: SyncChange): boolean {
  if (change.tableName === "categories") return change.action === "delete";
  if (change.tableName === "time_entries") return change.action !== "delete";
  return false;
}

/** 记一条待裁决冲突。同一 recordId 覆盖写：一条记录同时最多一个待裁决。 */
export async function recordPendingArbitration(
  change: SyncChange,
  syncLogIds: string[],
  disposition: PendingArbitration["disposition"] = "pending",
  now: Date = new Date(),
): Promise<void> {
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(change.data ?? null);
  } catch (error) {
    // 序列化失败也要留下可辨认的存根，不能让整条隔离链路因为一个 payload 崩掉。
    payloadJson = JSON.stringify({
      __serializeFailed: true,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  await db.pendingArbitrations.put({
    recordId: change.recordId,
    tableName: change.tableName,
    action: change.action,
    payloadJson,
    syncLogIds,
    rejectedAt: now.toISOString(),
    disposition,
  });
}

export async function listPendingArbitrations(): Promise<PendingArbitration[]> {
  return db.pendingArbitrations.toArray();
}

export async function clearPendingArbitration(recordId: string): Promise<void> {
  await db.pendingArbitrations.delete(recordId);
}
