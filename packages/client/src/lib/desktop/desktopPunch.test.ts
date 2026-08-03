import type { Category } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { setPunchCategoryId } from "../settings/punchCategorySetting.js";
import { desktopPunch, writePunch } from "./desktopPunch.js";

// APP 时区 +08:00。pressedAt = 2026-06-15 12:00 (+08:00)。
const PRESSED_AT_MS = new Date("2026-06-15T04:00:00.000Z").getTime();
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

async function seedEntryEndingAt(endTime: string) {
  await db.timeEntries.add({
    id: `entry-${endTime}`,
    categoryId: PUNCH_CATEGORY_ID,
    startTime: "2026-06-14T22:00:00.000Z",
    endTime,
    note: null,
    createdAt: endTime,
    updatedAt: endTime,
  });
}

beforeEach(resetDb);

describe("desktopPunch 预检分流", () => {
  it("阈值内直接写入并返回 written", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z"); // 距按键 1 小时
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") {
      expect(outcome.entry.startTime).toBe("2026-06-15T03:00:00.000Z");
      expect(outcome.entry.endTime).toBe("2026-06-15T04:00:00.000Z");
    }
    expect(await db.timeEntries.count()).toBe(2);
  });

  it("超阈值不写、返回 needsConfirm 与预览区间", async () => {
    await configurePunchCategory();
    // 无任何记录：起点回退今天 0 点（16:00Z 前日），区间 12 小时 > 4 小时——metaspec §2.8 的打歪场景
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome).toEqual({
      kind: "needsConfirm",
      range: { startTime: "2026-06-14T16:00:00.000Z", endTime: "2026-06-15T04:00:00.000Z" },
    });
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("区间恰好等于阈值不确认、直接写（> 判定）", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T00:00:00.000Z"); // 距按键恰 4 小时
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome.kind).toBe("written");
  });

  it("无时间可记返回 noRange 不写", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T04:00:00.000Z"); // 与按键同刻
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome).toEqual({ kind: "noRange" });
    expect(await db.timeEntries.count()).toBe(1);
  });

  it("未配置打点分类返回 missingCategory 不写", async () => {
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome).toEqual({ kind: "missingCategory" });
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("按键时刻向下取整到分钟（与 punchNow 同规）", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const outcome = await desktopPunch(PRESSED_AT_MS + 42_000, 4); // +42 秒
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") expect(outcome.entry.endTime).toBe("2026-06-15T04:00:00.000Z");
  });
});

describe("writePunch（确认卡的「记录」按当下数据重算）", () => {
  it("确认时同步已拉进记录 → 写入缩短后的准确区间", async () => {
    await configurePunchCategory();
    // 预检时空库 → needsConfirm 12 小时；确认前同步拉进一条 03:00Z 结束的记录
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const outcome = await writePunch(PRESSED_AT_MS);
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") {
      expect(outcome.entry.startTime).toBe("2026-06-15T03:00:00.000Z"); // 不是 0 点
    }
  });

  it("确认时区间已被盖满 → noRange 不写", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T04:00:00.000Z");
    const outcome = await writePunch(PRESSED_AT_MS);
    expect(outcome).toEqual({ kind: "noRange" });
  });
});
