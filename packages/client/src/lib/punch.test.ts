import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { PENDING_CATEGORY_ID } from "./pendingCategory.js";
import { punchNow, resolvePunchRange } from "./punch.js";

// 全部用 UTC ISO 字符串；APP 时区 +08:00，今天 0 点 = 前一日 16:00Z。
const TODAY_START = "2026-06-14T16:00:00.000Z"; // 2026-06-15 00:00 (+08:00)
const NOW = "2026-06-15T04:00:00.000Z"; // 2026-06-15 12:00 (+08:00)

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.categories.clear();
  await db.syncLog.clear();
});

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
  it("今天无记录：建一条 [今天0点 → now]、分类=待定 的记录，并自动播种待定分类", async () => {
    const now = new Date("2026-06-15T04:00:00.000Z"); // 12:00 (+08:00)
    const entry = await punchNow(now);

    expect(entry).not.toBeNull();
    expect(entry?.categoryId).toBe(PENDING_CATEGORY_ID);
    expect(entry?.startTime).toBe("2026-06-14T16:00:00.000Z"); // 今天 0 点
    expect(entry?.endTime).toBe("2026-06-15T04:00:00.000Z");
    await expect(db.categories.get(PENDING_CATEGORY_ID)).resolves.toMatchObject({ name: "待定" });
    await expect(db.syncLog.where({ tableName: "time_entries" }).count()).resolves.toBe(1);
  });

  it("今天已有记录：起点接上最后一条 end", async () => {
    await db.timeEntries.add({
      id: "e1",
      categoryId: "cat-invest-read",
      startTime: "2026-06-15T01:00:00.000Z",
      endTime: "2026-06-15T02:00:00.000Z", // 今天 10:00
      note: null,
      createdAt: "2026-06-15T02:00:00.000Z",
      updatedAt: "2026-06-15T02:00:00.000Z",
    });

    const entry = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(entry?.startTime).toBe("2026-06-15T02:00:00.000Z");
    expect(entry?.endTime).toBe("2026-06-15T04:00:00.000Z");
  });

  it("无时间可记时（最后一条结束于 now）返回 null，不写记录", async () => {
    await db.timeEntries.add({
      id: "e2",
      categoryId: "cat-invest-read",
      startTime: "2026-06-15T03:00:00.000Z",
      endTime: "2026-06-15T04:00:00.000Z",
      note: null,
      createdAt: "2026-06-15T04:00:00.000Z",
      updatedAt: "2026-06-15T04:00:00.000Z",
    });

    const entry = await punchNow(new Date("2026-06-15T04:00:00.000Z"));

    expect(entry).toBeNull();
    await expect(db.timeEntries.count()).resolves.toBe(1);
  });
});
