import { describe, expect, it } from "vitest";
import { currentDueDayFor } from "./recurrence.js";
import { TaskSchema } from "./schemas.js";
import { completeTask } from "./taskCompletion.js";
import { localDateOf } from "./taskDates.js";
import type { Task } from "./types.js";

let seq = 0;
const genId = () => `occ-${++seq}`;
const opts = (now: string) => ({ now: new Date(now), genId, occurrenceSortOrder: 99 });
const daily0 = () => ({ freq: "daily" as const, interval: 1, basis: "due" as const });

function baseTask(over: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: "t1",
    title: "跑步",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    subtasks: [],
    completedCount: 0,
    turn: null,
    turnAt: null,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  });
}

describe("completeTask", () => {
  it("重复非终结 root 完成时派生 occurrence children 快照并 reset template children", () => {
    seq = 0;
    const task = baseTask({
      id: "root-1",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 19)),
    });
    const children = [
      baseTask({
        id: "child-1",
        parentId: "root-1",
        title: "已完成子项",
        done: true,
        completedAt: "2026-06-19T07:00:00.000Z",
        tags: ["snapshot"],
        sortOrder: 0,
      }),
      baseTask({
        id: "child-2",
        parentId: "root-1",
        title: "未完成子项",
        done: false,
        completedAt: null,
        tags: ["later"],
        sortOrder: 1,
      }),
    ];

    const out = completeTask(task, {
      now: new Date("2026-06-19T08:00:00.000Z"),
      genId: () => `occ-${++seq}`,
      occurrenceSortOrder: 99,
      children,
    });

    expect(out.occurrence?.id).toBe("occ-1");
    expect(out.occurrenceChildren?.map((child) => [child.parentId, child.done, child.completedAt, child.recurrence, child.turn])).toEqual([
      ["occ-1", true, "2026-06-19T07:00:00.000Z", null, null],
      ["occ-1", false, null, null, null],
    ]);
    expect(out.occurrenceChildren?.map((child) => [child.id, child.title, child.tags, child.sortOrder])).toEqual([
      ["occ-2", "已完成子项", ["snapshot"], 0],
      ["occ-3", "未完成子项", ["later"], 1],
    ]);
    expect(out.templateChildren?.map((child) => [child.id, child.parentId, child.done, child.completedAt])).toEqual([
      ["child-1", "root-1", false, null],
      ["child-2", "root-1", false, null],
    ]);
  });

  it("非重复或终结路径不返回 child batches", () => {
    const child = baseTask({ id: "child-1", parentId: "root-1" });

    const nonRecurring = completeTask(baseTask({ id: "root-1" }), {
      ...opts("2026-06-19T08:00:00.000Z"),
      children: [child],
    });
    expect(nonRecurring.occurrenceChildren).toBeUndefined();
    expect(nonRecurring.templateChildren).toBeUndefined();

    const finished = completeTask(
      baseTask({
        id: "root-1",
        recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
        startAt: "2026-06-19T00:00:00.000Z",
      }),
      { ...opts("2026-06-19T08:00:00.000Z"), children: [child] },
    );
    expect(finished.occurrenceChildren).toBeUndefined();
    expect(finished.templateChildren).toBeUndefined();
  });

  it("拒绝直接完成 child task", () => {
    expect(() => completeTask(baseTask({ parentId: "root-1" }), opts("2026-06-19T08:00:00.000Z"))).toThrow(
      "completeTask requires a root task",
    );
  });

  it("非重复任务：就地完成、补 completedAt、清 turn，无 occurrence", () => {
    const task = baseTask({ turn: "running", turnAt: "2026-06-01T00:00:00.000Z" });
    const { next, occurrence } = completeTask(task, opts("2026-06-14T08:00:00.000Z"));

    expect(occurrence).toBeNull();
    expect(next).toMatchObject({
      id: "t1",
      done: true,
      completedAt: "2026-06-14T08:00:00.000Z",
      turn: null,
      turnAt: null,
    });
  });

  it("重复·非终结·准时：lastDoneAt 推进到当日应发生日（本地零点）", () => {
    const start = localDateOf(new Date(2026, 5, 14));
    const task = baseTask({
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: start,
      tags: ["健身"],
      subtasks: [{ id: "s1", title: "热身", done: true }],
      turn: "me",
      turnAt: "2026-06-01T00:00:00.000Z",
    });

    const { next, occurrence } = completeTask(task, opts("2026-06-14T08:00:00.000Z"));

    expect(occurrence).toMatchObject({
      done: true,
      recurrence: null,
      title: "跑步",
      tags: ["健身"],
      completedAt: "2026-06-14T08:00:00.000Z",
      turn: null,
    });
    expect(occurrence?.id).not.toBe("t1");
    expect(occurrence?.subtasks).toEqual([{ id: "s1", title: "热身", done: true }]);
    expect(next).toMatchObject({
      id: "t1",
      done: false,
      completedCount: 1,
      lastDoneAt: localDateOf(new Date(2026, 5, 14)),
      turn: null,
      turnAt: null,
    });
    expect(next.subtasks).toEqual([{ id: "s1", title: "热身", done: false }]);
    expect(next.recurrence).not.toBeNull();
  });

  it("重复·非终结·提前：lastDoneAt=应发生日，下次推进到下下次；occurrence.completedAt=实际时刻", () => {
    const task = baseTask({
      recurrence: { freq: "weekly", interval: 1, basis: "due", byWeekday: [1] },
      startAt: "2026-06-01T00:00:00.000Z",
      lastDoneAt: "2026-06-08T08:00:00.000Z",
    });

    const { next, occurrence } = completeTask(task, opts("2026-06-12T08:00:00.000Z"));

    expect(occurrence?.completedAt).toBe("2026-06-12T08:00:00.000Z");
    expect(next.lastDoneAt?.startsWith("2026-06-1")).toBe(true);
    expect(next.lastDoneAt).not.toBe("2026-06-12T08:00:00.000Z");
  });

  it("重复·终结(count 满)：就地转化、保留原 id、写 completedAt、无 occurrence", () => {
    const task = baseTask({
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      startAt: "2026-06-01T00:00:00.000Z",
    });

    const { next, occurrence } = completeTask(task, opts("2026-06-14T08:00:00.000Z"));

    expect(occurrence).toBeNull();
    expect(next).toMatchObject({
      id: "t1",
      recurrence: null,
      done: true,
      completedCount: 1,
      completedAt: "2026-06-14T08:00:00.000Z",
    });
  });

  describe("过期重复任务逐次追平（条⑧⑨）", () => {
    it("daily 错 1 天：lastDoneAt = 应发生日（startDay）；下次 due ≤ today，仍可再做", () => {
      const start = localDateOf(new Date(2026, 5, 13));
      const task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");
      const { next, occurrence } = completeTask(task, { now, genId, occurrenceSortOrder: 0 });

      expect(occurrence?.completedAt).toBe(now.toISOString());
      expect(next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 13)));

      const nextDueDay = currentDueDayFor(next.recurrence!, next.lastDoneAt, next.startAt, now);
      const todayDay = currentDueDayFor(daily0(), null, localDateOf(now), now);
      expect(nextDueDay).toBeLessThanOrEqual(todayDay);
    });

    it("daily 错 3 天连勾 4 次：每次推一格，第 4 次 lastDoneAt=今天、下次 > today 清空", () => {
      const start = localDateOf(new Date(2026, 5, 11));
      let task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");

      const expected = [
        localDateOf(new Date(2026, 5, 11)),
        localDateOf(new Date(2026, 5, 12)),
        localDateOf(new Date(2026, 5, 13)),
        localDateOf(new Date(2026, 5, 14)),
      ];
      for (let k = 0; k < 4; k++) {
        const { next } = completeTask(task, { now, genId, occurrenceSortOrder: k });
        expect(next.lastDoneAt).toBe(expected[k]);
        task = next;
      }
      const finalNextDue = currentDueDayFor(task.recurrence!, task.lastDoneAt, task.startAt, now);
      const todayDay = currentDueDayFor(daily0(), null, localDateOf(now), now);
      expect(finalNextDue).toBeGreaterThan(todayDay);
    });

    it("daily 提前完成（now < due）：lastDoneAt = 应发生日，下次顺延（提前不连跳保住）", () => {
      const start = localDateOf(new Date(2026, 5, 1));
      const task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        startAt: start,
        lastDoneAt: localDateOf(new Date(2026, 5, 13)),
      });
      const now = new Date("2026-06-13T20:00:00.000Z");
      const { next } = completeTask(task, { now, genId, occurrenceSortOrder: 0 });
      expect(next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 14)));
    });

    it("weekly·周一 错 2 周：第 1 次 lastDoneAt=startDay，第 2 次推到下一周一", () => {
      const start = localDateOf(new Date(2026, 5, 1));
      let task = baseTask({
        recurrence: { freq: "weekly", interval: 1, basis: "due", byWeekday: [1] },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");

      const r1 = completeTask(task, { now, genId, occurrenceSortOrder: 0 });
      expect(r1.next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 1)));
      task = r1.next;

      const r2 = completeTask(task, { now, genId, occurrenceSortOrder: 1 });
      expect(r2.next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 8)));
    });

    it("monthly·1号 错 2 月：3 次连勾依次推到 04-01 / 05-01 / 06-01", () => {
      const start = localDateOf(new Date(2026, 3, 1));
      let task = baseTask({
        recurrence: { freq: "monthly", interval: 1, basis: "due", byMonthday: [1] },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");

      const expected = [
        localDateOf(new Date(2026, 3, 1)),
        localDateOf(new Date(2026, 4, 1)),
        localDateOf(new Date(2026, 5, 1)),
      ];
      for (let k = 0; k < 3; k++) {
        const { next } = completeTask(task, { now, genId, occurrenceSortOrder: k });
        expect(next.lastDoneAt).toBe(expected[k]);
        task = next;
      }
    });

    it("until 边界：dueIso 推下次 ≤ until 不终结；再勾一次到 until 当天才终结", () => {
      const start = localDateOf(new Date(2026, 5, 13));
      const until = localDateOf(new Date(2026, 5, 14));
      const task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due", until },
        startAt: start,
      });
      const now1 = new Date("2026-06-14T08:00:00.000Z");
      const r1 = completeTask(task, { now: now1, genId, occurrenceSortOrder: 0 });
      expect(r1.next.recurrence).not.toBeNull();
      expect(r1.next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 13)));

      const r2 = completeTask(r1.next, { now: now1, genId, occurrenceSortOrder: 1 });
      expect(r2.next.recurrence).toBeNull();
      expect(r2.next.done).toBe(true);
      expect(r2.next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 14)));
    });

    it("过期场景下 occurrence.completedAt = 实际点击时刻（与 lastDoneAt 分离）", () => {
      const start = localDateOf(new Date(2026, 5, 13));
      const task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");
      const { next, occurrence } = completeTask(task, { now, genId, occurrenceSortOrder: 0 });
      expect(occurrence?.completedAt).toBe(now.toISOString());
      expect(next.lastDoneAt).not.toBe(now.toISOString());
      expect(next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 13)));
    });

    it("count=1 终结：completedAt=nowIso，lastDoneAt=dueIso（应发生日）", () => {
      const start = localDateOf(new Date(2026, 5, 13));
      const task = baseTask({
        recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
        startAt: start,
      });
      const now = new Date("2026-06-14T08:00:00.000Z");
      const { next, occurrence } = completeTask(task, { now, genId, occurrenceSortOrder: 0 });
      expect(occurrence).toBeNull();
      expect(next.recurrence).toBeNull();
      expect(next.done).toBe(true);
      expect(next.completedAt).toBe(now.toISOString());
      expect(next.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 13)));
    });
  });
});
