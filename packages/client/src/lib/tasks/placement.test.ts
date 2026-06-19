import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import { placementForTask, normalizeScheduledDate, localDateOf, isExhausted } from "./placement.js";

const TODAY = new Date("2026-06-14T08:00:00.000Z");
function task(p: Partial<Task>): Task {
  return { id: "t", title: "x", done: false, recurrence: null, lastDoneAt: null,
    startAt: null, scheduledAt: null, completedCount: 0, sortOrder: 0,
    createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z", ...p };
}

describe("placementForTask 普通任务", () => {
  it("scheduledAt=null → inbox", () => {
    expect(placementForTask(task({}), TODAY).pool).toBe("inbox");
  });
  it("scheduledAt=今天 → today, 不过期", () => {
    const r = placementForTask(task({ scheduledAt: "2026-06-14T00:00:00.000Z" }), TODAY);
    expect(r).toEqual({ pool: "today", overdue: false });
  });
  it("scheduledAt=过去 → inbox（非重复待办过期回归收件箱）", () => {
    const r = placementForTask(task({ scheduledAt: "2026-06-10T00:00:00.000Z" }), TODAY);
    expect(r).toEqual({ pool: "inbox" });
  });
  it("scheduledAt=未来 → upcoming", () => {
    expect(placementForTask(task({ scheduledAt: "2026-12-25T00:00:00.000Z" }), TODAY).pool).toBe("upcoming");
  });
  it("done → completed", () => {
    expect(placementForTask(task({ done: true, scheduledAt: "2026-06-14T00:00:00.000Z" }), TODAY).pool).toBe("completed");
  });
});

describe("placementForTask 重复任务", () => {
  const daily = { freq: "daily" as const, interval: 1, basis: "due" as const };
  it("今天到期未做 → today", () => {
    const r = placementForTask(task({ recurrence: daily, startAt: "2026-06-14T00:00:00.000Z" }), TODAY);
    expect(r.pool).toBe("today");
  });
  it("昨天起未做的每日任务 → today overdue", () => {
    const r = placementForTask(task({ recurrence: daily, startAt: "2026-06-10T00:00:00.000Z" }), TODAY);
    expect(r).toEqual({ pool: "today", overdue: true });
  });
  it("下次实例在未来 → recurring（重复区管理，不进 upcoming）", () => {
    const yearly = { freq: "monthly" as const, interval: 12, byMonthday: [25], basis: "due" as const };
    const r = placementForTask(task({ recurrence: yearly, startAt: "2025-12-25T00:00:00.000Z",
      lastDoneAt: "2025-12-25T01:00:00.000Z" }), TODAY);
    expect(r.pool).toBe("recurring");
  });
  it("每日任务今天已完成 → recurring（不再与即将到来重复显示）", () => {
    const r = placementForTask(task({ recurrence: daily, startAt: "2026-06-01T00:00:00.000Z",
      lastDoneAt: "2026-06-14T06:00:00.000Z" }), TODAY);
    expect(r.pool).toBe("recurring");
  });
});

describe("normalizeScheduledDate", () => {
  it("YYYY-MM-DD → 本地零点 UTC ISO", () => {
    expect(normalizeScheduledDate("2026-06-14")).toBe(localDateOf(new Date(2026, 5, 14)));
  });
});

describe("isExhausted", () => {
  const now = new Date("2026-06-15T08:00:00.000Z");

  it("count 已满 → 完成", () => {
    const t = task({
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 3 },
      completedCount: 3,
      startAt: "2026-06-01T00:00:00.000Z",
    });
    expect(isExhausted(t, now)).toBe(true);
    expect(placementForTask(t, now)).toEqual({ pool: "completed" });
  });

  it("until 已过且无到期 → 完成", () => {
    const t = task({
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-10T00:00:00.000Z" },
      lastDoneAt: "2026-06-10T09:00:00.000Z",
      startAt: "2026-06-01T00:00:00.000Z",
    });
    expect(isExhausted(t, now)).toBe(true);
  });

  it("until 已过但有逾期未完成 → 不完成（留在今天）", () => {
    const t = task({
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-10T00:00:00.000Z" },
      lastDoneAt: null,
      startAt: "2026-06-01T00:00:00.000Z",
    });
    expect(isExhausted(t, now)).toBe(false);
    expect(placementForTask(t, now)).toMatchObject({ pool: "today" });
  });

  it("until 在未来 → 不完成", () => {
    const t = task({
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-20T00:00:00.000Z" },
      startAt: "2026-06-01T00:00:00.000Z",
    });
    expect(isExhausted(t, now)).toBe(false);
  });
});
