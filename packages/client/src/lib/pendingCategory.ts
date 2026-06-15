import type { Category } from "@timedata/shared";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

/** 打点落点分类：固定 id，便于幂等定位与跨端同步对齐。 */
export const PENDING_CATEGORY_ID = "cat-pending";
export const PENDING_CATEGORY_NAME = "待定";
/** 中性灰，区别于其它彩色一级分类。 */
export const PENDING_CATEGORY_COLOR = "#94A3B8";

/**
 * 确保存在一个可用（未归档）的「待定」一级分类，返回其 id。
 * 缺失则建；被归档则取消归档（服务端会拒绝引用 archived 分类的记录同步）。
 */
export async function ensurePendingCategory(now: Date = new Date()): Promise<string> {
  return db.transaction("rw", db.categories, db.syncLog, async () => {
    const ts = now.toISOString();
    const existing = await db.categories.get(PENDING_CATEGORY_ID);
    if (existing) {
      if (existing.isArchived) {
        await db.categories.update(PENDING_CATEGORY_ID, { isArchived: false, updatedAt: ts });
        await recordSyncLog("categories", PENDING_CATEGORY_ID, "update");
      }
      return PENDING_CATEGORY_ID;
    }

    const topLevel = await db.categories.filter((category) => category.parentId === null).toArray();
    const cat: Category = {
      id: PENDING_CATEGORY_ID,
      name: PENDING_CATEGORY_NAME,
      parentId: null,
      color: PENDING_CATEGORY_COLOR,
      icon: null,
      sortOrder: topLevel.filter((category) => !category.isArchived).length,
      isArchived: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.categories.add(cat);
    await recordSyncLog("categories", PENDING_CATEGORY_ID, "create");
    return PENDING_CATEGORY_ID;
  });
}
