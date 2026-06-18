import { describe, expect, it } from "vitest";
import { TaskSchema } from "./schemas.js";
import { completeTask } from "./taskCompletion.js";
import type { Task } from "./types.js";

let seq = 0;
const genId = () => `occ-${++seq}`;
const opts = (now: string) => ({ now: new Date(now), genId, occurrenceSortOrder: 99 });

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

  it("重复·非终结·准时：衍生完成记录 + 推进模板", () => {
    const task = baseTask({
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-01T00:00:00.000Z",
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
      lastDoneAt: "2026-06-14T08:00:00.000Z",
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
});
