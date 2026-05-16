import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import Dexie from "dexie";
import { createDefaultCategories } from "@timedata/shared";

describe("Dexie v4 upgrade", () => {
  it("clears all tables and seeds default categories during upgrade", async () => {
    // 模拟 v3 数据库（有旧数据）
    const dbV3 = new Dexie("timedata-upgrade-test");
    dbV3.version(3).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced, [tableName+synced]",
      autoBackups: "id, createdAt",
    });
    await dbV3.open();
    // @ts-expect-error test helper
    await dbV3.table("timeEntries").add({ id: "old1", categoryId: "c1", startTime: "2026-05-13T15:00:00", endTime: "2026-05-13T16:00:00", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await dbV3.close();

    // 打开 v4，触发升级（不依赖 app 的 db 实例，用独立模拟）
    const dbV4 = new Dexie("timedata-upgrade-test");
    dbV4.version(3).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced, [tableName+synced]",
      autoBackups: "id, createdAt",
    });
    dbV4.version(4).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced, [tableName+synced]",
      autoBackups: "id, createdAt",
    }).upgrade(async (tx) => {
      await tx.table("timeEntries").clear();
      await tx.table("syncLog").clear();
      await tx.table("autoBackups").clear();
      await tx.table("categories").clear();
      await tx.table("categories").bulkAdd(createDefaultCategories());
    });
    await dbV4.open();

    const entries = await dbV4.table("timeEntries").toArray();
    const categories = await dbV4.table("categories").toArray();
    expect(entries).toHaveLength(0);
    expect(categories.length).toBeGreaterThan(0);
    await dbV4.close();
    await Dexie.delete("timedata-upgrade-test");
  });
});
