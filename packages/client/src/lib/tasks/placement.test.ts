import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import { placementForTask, normalizeScheduledDate, localDateOf } from "./placement.js";

const TODAY = new Date("2026-06-14T08:00:00.000Z");
function task(p: Partial<Task>): Task {
  return { id: "t", title: "x", done: false, recurrence: null, lastDoneAt: null,
    startAt: null, scheduledAt: null, subtasks: [], sortOrder: 0,
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
  it("scheduledAt=过去 → today, overdue", () => {
    const r = placementForTask(task({ scheduledAt: "2026-06-10T00:00:00.000Z" }), TODAY);
    expect(r).toEqual({ pool: "today", overdue: true });
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
  it("下次实例在未来 → upcoming", () => {
    const yearly = { freq: "monthly" as const, interval: 12, byMonthday: [25], basis: "due" as const };
    const r = placementForTask(task({ recurrence: yearly, startAt: "2025-12-25T00:00:00.000Z",
      lastDoneAt: "2025-12-25T01:00:00.000Z" }), TODAY);
    expect(r.pool).toBe("upcoming");
  });
});

describe("normalizeScheduledDate", () => {
  it("YYYY-MM-DD → 本地零点 UTC ISO", () => {
    expect(normalizeScheduledDate("2026-06-14")).toBe(localDateOf(new Date(2026, 5, 14)));
  });
});
