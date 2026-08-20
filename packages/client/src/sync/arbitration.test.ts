import "fake-indexeddb/auto"; // 与 engine.test.ts 同款：Dexie 需要 IndexedDB 实现
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.ts";
import { clearPendingArbitration, listPendingArbitrations, recordPendingArbitration } from "./arbitration.ts";

const change = {
  tableName: "time_entries" as const,
  recordId: "entry-offline",
  action: "create" as const,
  data: {
    id: "entry-offline",
    categoryId: "cat-wash",
    startTime: "2026-08-19T11:58:00.000Z",
    endTime: "2026-08-19T12:42:00.000Z",
    note: null,
    createdAt: "2026-08-19T15:31:00.000Z",
    updatedAt: "2026-08-19T15:31:00.000Z",
  },
  timestamp: "2026-08-19T15:31:00.000Z",
};

describe("pending arbitration", () => {
  beforeEach(async () => {
    await db.pendingArbitrations.clear();
  });

  it("stores the full payload so it survives without the sync log", async () => {
    await recordPendingArbitration(change, ["log-1"], new Date("2026-08-19T15:31:30.000Z"));

    const rows = await listPendingArbitrations();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payloadJson)).toMatchObject({
      id: "entry-offline",
      startTime: "2026-08-19T11:58:00.000Z",
      endTime: "2026-08-19T12:42:00.000Z",
    });
    expect(rows[0].syncLogIds).toEqual(["log-1"]);
    expect(rows[0].rejectedAt).toBe("2026-08-19T15:31:30.000Z");
  });

  it("keeps one row per record instead of piling duplicates", async () => {
    await recordPendingArbitration(change, ["log-1"], new Date("2026-08-19T15:31:30.000Z"));
    await recordPendingArbitration(change, ["log-2"], new Date("2026-08-19T15:40:00.000Z"));

    const rows = await listPendingArbitrations();
    expect(rows).toHaveLength(1);
    expect(rows[0].syncLogIds).toEqual(["log-2"]);
  });

  it("clears by record id", async () => {
    await recordPendingArbitration(change, ["log-1"]);
    await clearPendingArbitration("entry-offline");
    expect(await listPendingArbitrations()).toHaveLength(0);
  });

  // 搁置超过 7 天后 pruneSyncedLogs 会清掉隔离日志（那条行为已由 engine.test.ts
  // 「同窗口回收 synced=2 的隔离死信日志」覆盖）。这里直接删日志来模拟那个终局，
  // 只守一件事：冲突记录独立于 syncLog 存活。
  it("still holds the full payload after its sync log is gone", async () => {
    await recordPendingArbitration(change, ["log-1"], new Date("2026-08-01T00:00:00.000Z"));

    await db.syncLog.delete("log-1");

    const rows = await listPendingArbitrations();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payloadJson)).toMatchObject({
      id: "entry-offline",
      startTime: "2026-08-19T11:58:00.000Z",
      endTime: "2026-08-19T12:42:00.000Z",
    });
  });
});
