import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { ensurePendingCategory, PENDING_CATEGORY_ID } from "./pendingCategory.js";

beforeEach(async () => {
  await db.categories.clear();
  await db.syncLog.clear();
});

describe("ensurePendingCategory", () => {
  it("缺失时创建一个未归档的待定一级分类并写 syncLog", async () => {
    const id = await ensurePendingCategory(new Date("2026-06-15T02:00:00.000Z"));

    expect(id).toBe(PENDING_CATEGORY_ID);
    const cat = await db.categories.get(PENDING_CATEGORY_ID);
    expect(cat).toMatchObject({ name: "待定", parentId: null, isArchived: false });
    await expect(db.syncLog.where("recordId").equals(PENDING_CATEGORY_ID).toArray()).resolves.toMatchObject([
      { tableName: "categories", action: "create", synced: 0 },
    ]);
  });

  it("已存在且未归档时幂等，不重复写 syncLog", async () => {
    await ensurePendingCategory();
    await db.syncLog.clear();

    const id = await ensurePendingCategory();

    expect(id).toBe(PENDING_CATEGORY_ID);
    await expect(db.categories.count()).resolves.toBe(1);
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("被归档时取消归档并写一条 update", async () => {
    await ensurePendingCategory();
    await db.categories.update(PENDING_CATEGORY_ID, { isArchived: true });
    await db.syncLog.clear();

    const id = await ensurePendingCategory();

    expect(id).toBe(PENDING_CATEGORY_ID);
    await expect(db.categories.get(PENDING_CATEGORY_ID)).resolves.toMatchObject({ isArchived: false });
    await expect(db.syncLog.where("recordId").equals(PENDING_CATEGORY_ID).toArray()).resolves.toMatchObject([
      { tableName: "categories", action: "update", synced: 0 },
    ]);
  });
});
