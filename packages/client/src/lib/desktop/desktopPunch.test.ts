import type { Category } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { punchNow } from "../punch.js";
import { setPunchCategoryId } from "../settings/punchCategorySetting.js";
import { desktopPunch, rangeHours } from "./desktopPunch.js";

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

  it("既无区间又无分类时报 noRange（判定序与 punchNow 一致，同一次按键两条路径不许两种说法）", async () => {
    await seedEntryEndingAt("2026-06-15T04:00:00.000Z"); // 盖到按键时刻 → 无区间；且全程没配打点分类
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome).toEqual({ kind: "noRange" });
  });

  it("按键时刻向下取整到分钟（与 punchNow 同规）", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const outcome = await desktopPunch(PRESSED_AT_MS + 42_000, 4); // +42 秒
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") expect(outcome.entry.endTime).toBe("2026-06-15T04:00:00.000Z");
  });

  it("预览区间的终点同样取整到分钟（needsConfirm 不经 punchNow，取整必须是本函数自己做的）", async () => {
    await configurePunchCategory();
    const outcome = await desktopPunch(PRESSED_AT_MS + 42_000, 4); // 空库 → 12 小时 → 弹卡
    expect(outcome.kind).toBe("needsConfirm");
    if (outcome.kind === "needsConfirm") expect(outcome.range.endTime).toBe("2026-06-15T04:00:00.000Z");
  });
});

describe("确认卡批准后重试：maxHours = 用户批准的那个区间长度", () => {
  it("批准 1 小时后同步删掉了那条记录 → 重算成 12 小时，再弹卡而不是闷头写", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");

    // 阈值 0.5 小时 → 1 小时区间要确认；卡上给用户看的是 03:00–04:00
    const preview = await desktopPunch(PRESSED_AT_MS, 0.5);
    expect(preview).toEqual({
      kind: "needsConfirm",
      range: { startTime: "2026-06-15T03:00:00.000Z", endTime: "2026-06-15T04:00:00.000Z" },
    });
    const approvedHours = preview.kind === "needsConfirm" ? rangeHours(preview.range) : Number.NaN;
    expect(approvedHours).toBe(1);

    // 用户盯着卡的这会儿，手机端删了那条记录并同步下来
    await db.timeEntries.clear();

    // 点「记录」：批准的是 1 小时，当下数据重算是 12 小时 → 必须再问一次，绝不落库
    const retry = await desktopPunch(PRESSED_AT_MS, approvedHours);
    expect(retry).toEqual({
      kind: "needsConfirm",
      range: { startTime: "2026-06-14T16:00:00.000Z", endTime: "2026-06-15T04:00:00.000Z" },
    });
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("确认时同步已拉进记录 → 写入缩短后的准确区间（变短仍是更准，直接写）", async () => {
    await configurePunchCategory();
    // 预检时空库 → needsConfirm 12 小时；确认前同步拉进一条 03:00Z 结束的记录
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const outcome = await desktopPunch(PRESSED_AT_MS, 12);
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") {
      expect(outcome.entry.startTime).toBe("2026-06-15T03:00:00.000Z"); // 不是 0 点
    }
  });

  it("确认时区间已被盖满 → noRange 不写", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T04:00:00.000Z");
    const outcome = await desktopPunch(PRESSED_AT_MS, 12);
    expect(outcome).toEqual({ kind: "noRange" });
  });

  // 守门员的失败方向必须 fail-closed：NaN 的一切比较都是 false，写成 `> maxHours`
  // 会让上一条用例那种 `? … : Number.NaN` 的回退模式一旦走错分支就静默放行整段区间。
  it("maxHours 为 NaN 时弹卡而不是放行（闸坏了要往安全一侧倒）", async () => {
    await configurePunchCategory();
    const outcome = await desktopPunch(PRESSED_AT_MS, Number.NaN);
    expect(outcome.kind).toBe("needsConfirm");
    expect(await db.timeEntries.count()).toBe(0);
  });
});

// 上面那些用例断的都是**具体时刻**（03:00 / 12:00 …），它们钉的是「这一次算对了」。
// 这条钉的是不变量本身：无论走哪条分支，desktopPunch 落进库里的记录长度都不许超过
// 调用方给的上限——这正是「超阈值防打歪」这个特性存在的全部理由。
describe("不变量：落库长度绝不超过已批准长度", () => {
  async function everyWrittenEntryWithin(maxHours: number) {
    for (const entry of await db.timeEntries.toArray()) {
      expect(rangeHours(entry)).toBeLessThanOrEqual(maxHours);
    }
  }

  it("超上限时改弹卡，绝不落一条超长的（空库 → 12 小时 > 4）", async () => {
    await configurePunchCategory();
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    if (outcome.kind === "written") expect(rangeHours(outcome.entry)).toBeLessThanOrEqual(4);
    await everyWrittenEntryWithin(4);
  });

  it("上限内写下的那条也在上限内（1 小时 ≤ 4）", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const outcome = await desktopPunch(PRESSED_AT_MS, 4);
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") expect(rangeHours(outcome.entry)).toBeLessThanOrEqual(4);
    // seed 那条不是本次写的，逐条查会把它算进来——只查本次的结果即可。
  });

  it("批准后重试写下的那条不超过用户批准的长度", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const approvedHours = 1;
    const outcome = await desktopPunch(PRESSED_AT_MS, approvedHours);
    expect(outcome.kind).toBe("written");
    if (outcome.kind === "written") expect(rangeHours(outcome.entry)).toBeLessThanOrEqual(approvedHours);
  });
});

// 桌面预检把 punch.ts 的区间推导复刻了一份（取整到分钟 → 今天 0 点 → 查锚点 →
// resolvePunchRange）。分叉的后果不是「算错」，而是**守门员守错了对象**：确认卡上给用户看的
// 区间、以及那道自守闸比对的，都是旧规则算的，落笔的却是新规则算的。历史上有过一次提交
// （floor 到分钟）改的正是这四行中的三行。
describe("跨文件一致性：预检算出的区间 = punchNow 实际写入的区间", () => {
  it("同一份库状态下两处推导必须逐字一致", async () => {
    await configurePunchCategory();
    await seedEntryEndingAt("2026-06-15T03:00:00.000Z");
    const pressedAtMs = PRESSED_AT_MS + 42_000; // 带秒，取整规则不一致时立刻分叉

    // 阈值压到 0.5 小时强制走 needsConfirm，才拿得到预检那份区间（它不经 punchNow）
    const preview = await desktopPunch(pressedAtMs, 0.5);
    expect(preview.kind).toBe("needsConfirm");

    const result = await punchNow(new Date(pressedAtMs));
    expect(result.ok).toBe(true);

    if (preview.kind === "needsConfirm" && result.ok) {
      expect({ startTime: result.entry.startTime, endTime: result.entry.endTime }).toEqual(preview.range);
    }
  });

  it("没有锚点记录时（起点回退今天 0 点）同样一致", async () => {
    await configurePunchCategory();
    const preview = await desktopPunch(PRESSED_AT_MS, 0.5);
    expect(preview.kind).toBe("needsConfirm");

    const result = await punchNow(new Date(PRESSED_AT_MS));
    expect(result.ok).toBe(true);

    if (preview.kind === "needsConfirm" && result.ok) {
      expect({ startTime: result.entry.startTime, endTime: result.entry.endTime }).toEqual(preview.range);
    }
  });
});
