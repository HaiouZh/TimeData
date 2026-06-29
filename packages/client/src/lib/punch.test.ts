import type { Category } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { findOverlappingEntries } from "../hooks/useEntries.js";
import { db, resetDb } from "../test/dbReset.js";
import { punchNow, resolvePunchRange } from "./punch.js";
import { setPunchCategoryId } from "./settings/punchCategorySetting.js";

// 全部用 UTC ISO 字符串；APP 时区 +08:00，今天 0 点 = 前一日 16:00Z。
const TODAY_START = "2026-06-14T16:00:00.000Z"; // 2026-06-15 00:00 (+08:00)
const NOW = "2026-06-15T04:00:00.000Z"; // 2026-06-15 12:00 (+08:00)
const PUNCH_CATEGORY_ID = "cat-work-deep";

function category(id: string, name: string, parentId: string | null): Category {
  return {
    id,
    name,
    parentId,
    color: "#94A3B8",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  };
}

async function configurePunchCategory() {
  await db.categories.bulkAdd([category("cat-work", "工作", null), category(PUNCH_CATEGORY_ID, "深度", "cat-work")]);
  await setPunchCategoryId(PUNCH_CATEGORY_ID);
  await db.syncLog.clear();
}

beforeEach(resetDb);

describe("resolvePunchRange", () => {
  it("今天有记录时，起点=今天最后一条 end", () => {
    const lastEnd = "2026-06-15T02:00:00.000Z"; // 今天 10:00
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toEqual({ startTime: lastEnd, endTime: NOW });
  });

  it("今天没有记录（最后一条结束于昨天）时，起点=今天 0 点", () => {
    const lastEnd = "2026-06-14T15:00:00.000Z"; // 昨天 23:00
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toEqual({ startTime: TODAY_START, endTime: NOW });
  });

  it("完全没有任何记录时，起点=今天 0 点", () => {
    expect(resolvePunchRange(NOW, TODAY_START, null)).toEqual({ startTime: TODAY_START, endTime: NOW });
  });

  it("起点不早于 now（无时间可记）时返回 null", () => {
    const lastEnd = NOW; // 上一条恰好结束于现在
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toBeNull();
  });
});

describe("punchNow", () => {
  it("打点终点向下取整到分钟，丢弃秒/毫秒", async () => {
    await configurePunchCategory();
    const result = await punchNow(new Date("2026-06-15T04:00:37.456Z")); // 12:00:37.456 (+08:00)

    expect(result).toMatchObject({ ok: true });
    const entry = result.ok ? result.entry : null;
    expect(entry?.endTime).toBe("2026-06-15T04:00:00.000Z"); // 取整到 12:00:00
  });

  it("打点后紧接同一分钟起点手动记一笔不应重叠", async () => {
    await configurePunchCategory();
    await punchNow(new Date("2026-06-15T04:00:37.456Z"));

    const overlaps = await findOverlappingEntries("2026-06-15T04:00:00.000Z", "2026-06-15T04:30:00.000Z");

    expect(overlaps).toEqual([]);
  });

  it("今天无记录：建一条 [今天0点 → now]、分类=已配置打点分类 的记录", async () => {
    await configurePunchCategory();
    const now = new Date("2026-06-15T04:00:00.000Z"); // 12:00 (+08:00)
    const result = await punchNow(now);

    expect(result).toMatchObject({ ok: true });
    const entry = result.ok ? result.entry : null;
    expect(entry?.categoryId).toBe(PUNCH_CATEGORY_ID);
    expect(entry?.startTime).toBe("2026-06-14T16:00:00.000Z"); // 今天 0 点
    expect(entry?.endTime).toBe("2026-06-15T04:00:00.000Z");
    await expect(db.syncLog.where({ tableName: "time_entries" }).count()).resolves.toBe(1);
  });

  it("今天已有记录：起点接上最后一条 end", async () => {
    await configurePunchCategory();
    await db.timeEntries.add({
      id: "e1",
      categoryId: "cat-invest-read",
      startTime: "2026-06-15T01:00:00.000Z",
      endTime: "2026-06-15T02:00:00.000Z", // 今天 10:00
      note: null,
      createdAt: "2026-06-15T02:00:00.000Z",
      updatedAt: "2026-06-15T02:00:00.000Z",
    });

    const result = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(result).toMatchObject({ ok: true });
    const entry = result.ok ? result.entry : null;
    expect(entry?.categoryId).toBe(PUNCH_CATEGORY_ID);
    expect(entry?.startTime).toBe("2026-06-15T02:00:00.000Z");
    expect(entry?.endTime).toBe("2026-06-15T04:00:00.000Z");
  });

  it("无时间可记时（最后一条结束于 now）返回 no_range，不写记录", async () => {
    await configurePunchCategory();
    await db.timeEntries.add({
      id: "e2",
      categoryId: "cat-invest-read",
      startTime: "2026-06-15T03:00:00.000Z",
      endTime: "2026-06-15T04:00:00.000Z",
      note: null,
      createdAt: "2026-06-15T04:00:00.000Z",
      updatedAt: "2026-06-15T04:00:00.000Z",
    });

    const result = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(result).toEqual({ ok: false, reason: "no_range" });
    await expect(db.timeEntries.count()).resolves.toBe(1);
  });

  it("未配置打点分类时不写记录", async () => {
    const result = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(result).toEqual({ ok: false, reason: "missing_category" });
    await expect(db.timeEntries.count()).resolves.toBe(0);
    await expect(db.syncLog.where({ tableName: "time_entries" }).count()).resolves.toBe(0);
  });

  it("配置的分类不是可用子分类时不写记录", async () => {
    await db.categories.bulkAdd([
      category("cat-work", "工作", null),
      { ...category(PUNCH_CATEGORY_ID, "深度", "cat-work"), isArchived: true },
    ]);
    await setPunchCategoryId(PUNCH_CATEGORY_ID);
    await db.syncLog.clear();

    const result = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(result).toEqual({ ok: false, reason: "missing_category" });
    await expect(db.timeEntries.count()).resolves.toBe(0);
  });
});
