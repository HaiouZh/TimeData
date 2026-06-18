import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { localDateOf } from "./tasks/placement.js";
import {
  addTask,
  deleteTask,
  listTasks,
  persistTaskOrder,
  scheduleTask,
  setTaskTags,
  setTaskTurn,
  toggleTaskDone,
  unscheduleTask,
  updateSubtasks,
  updateTask,
} from "./tasks.js";

beforeEach(async () => {
  await db.tasks.clear();
  await db.syncLog.clear();
});

describe("addTask", () => {
  it("adds a pool task and writes a syncLog", async () => {
    const task = await addTask({ title: "  买啤酒  ", now: new Date("2026-06-14T08:00:00.000Z") });

    expect(task).toMatchObject({ title: "买啤酒", recurrence: null, done: false });
    await expect(db.tasks.get(task.id)).resolves.toBeDefined();
    await expect(db.syncLog.where("recordId").equals(task.id).toArray()).resolves.toMatchObject([
      { tableName: "tasks", action: "create", timestamp: "2026-06-14T08:00:00.000Z", synced: 0 },
    ]);
  });

  it("adds a recurring task with startAt defaulting to createdAt", async () => {
    const task = await addTask({
      title: "跑步",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T08:00:00.000Z"),
    });

    expect(task).toMatchObject({
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-14T08:00:00.000Z",
    });
  });

  it("rejects empty title", async () => {
    await expect(addTask({ title: "  " })).rejects.toThrow("任务标题不能为空");
  });

  it("addTask 默认 scheduledAt = 今天本地零点", async () => {
    const now = new Date("2026-06-14T08:00:00.000Z");
    const t = await addTask({ title: "今天的事", now });
    expect(t.scheduledAt).toBe(localDateOf(now));
    expect(t.subtasks).toEqual([]);
  });

  it("addTask 放入 inbox 时 scheduledAt=null", async () => {
    const t = await addTask({ title: "收纳", toInbox: true });
    expect(t.scheduledAt).toBeNull();
  });

  it("addTask 重复任务 scheduledAt=null", async () => {
    const t = await addTask({
      title: "刮胡子",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
    });
    expect(t.scheduledAt).toBeNull();
  });
});

describe("toggleTaskDone", () => {
  it("pool task: flips done", async () => {
    const task = await addTask({ title: "x" });

    const done = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(done.done).toBe(true);
    expect(done.lastDoneAt).toBeNull();
    expect(done.completedAt).toBe("2026-06-14T08:00:00.000Z");

    const undone = await toggleTaskDone(task.id, { now: new Date("2026-06-14T09:00:00.000Z") });

    expect(undone.done).toBe(false);
    expect(undone.completedAt).toBeNull();
    await expect(db.syncLog.where("recordId").equals(task.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "update" })]),
    );
  });

  it("recurring task: stamps lastDoneAt instead of done", async () => {
    const task = await addTask({ title: "跑步", recurrence: { freq: "daily", interval: 1, basis: "due" } });

    const after = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(after.lastDoneAt).toBe("2026-06-14T08:00:00.000Z");
    expect(after.done).toBe(false);
  });

  it("重复任务未终结完成：子任务重置为未完成", async () => {
    const t = await addTask({ title: "喝水", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await updateSubtasks(t.id, [
      { id: "s1", title: "倒水", done: true },
      { id: "s2", title: "喝完", done: true },
    ]);
    const done = await toggleTaskDone(t.id, { now: new Date("2026-06-14T08:00:00.000Z") });
    expect(done.subtasks.every((s) => s.done === false)).toBe(true);
    expect(done.lastDoneAt).toBe("2026-06-14T08:00:00.000Z");
    expect(done.done).toBe(false);
  });

  it("重复任务终结性完成（count 满）：子任务保留勾选", async () => {
    const t = await addTask({
      title: "做一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    await updateSubtasks(t.id, [{ id: "s1", title: "x", done: true }]);
    const done = await toggleTaskDone(t.id, { now: new Date("2026-06-01T09:00:00.000Z") });
    expect(done.done).toBe(true);
    expect(done.subtasks[0].done).toBe(true);
  });
});

describe("终止式重复 toggle", () => {
  it("COUNT 满 → done 翻真、计数到位", async () => {
    const t = await addTask({
      title: "做三次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 3 },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    expect(t.completedCount).toBe(0);
    await toggleTaskDone(t.id, { now: new Date("2026-06-01T09:00:00.000Z") });
    await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    const t3 = await toggleTaskDone(t.id, { now: new Date("2026-06-03T09:00:00.000Z") });
    expect(t3.completedCount).toBe(3);
    expect(t3.done).toBe(true);
  });

  it("UNTIL：完成最后一次后无后续 → done 翻真", async () => {
    const t = await addTask({
      title: "到月中",
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-02T00:00:00.000Z" },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    const done = await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    expect(done.done).toBe(true);
  });

  it("普通池任务 completedCount 恒 0", async () => {
    const t = await addTask({ title: "买菜", now: new Date("2026-06-01T08:00:00.000Z") });
    expect(t.completedCount).toBe(0);
    const toggled = await toggleTaskDone(t.id, { now: new Date("2026-06-01T09:00:00.000Z") });
    expect(toggled.completedCount).toBe(0);
    expect(toggled.done).toBe(true);
  });
});

describe("setTaskTags", () => {
  it("writes task tags", async () => {
    const task = await addTask({ title: "想法", toInbox: true });
    const updated = await setTaskTags(task.id, ["agent", "idea"], { now: new Date("2026-06-14T09:00:00.000Z") });

    expect(updated.tags).toEqual(["agent", "idea"]);
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({ tags: ["agent", "idea"] });
    await expect(db.syncLog.where("recordId").equals(task.id).toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "tasks", action: "update", timestamp: "2026-06-14T09:00:00.000Z" }),
      ]),
    );
  });
});

describe("updateTask", () => {
  it("updates title and can convert pool task to recurring", async () => {
    const task = await addTask({ title: "old", now: new Date("2026-06-14T08:00:00.000Z") });

    const next = await updateTask(task.id, {
      title: "new",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
      now: new Date("2026-06-14T09:00:00.000Z"),
    });

    expect(next).toMatchObject({ title: "new", recurrence: { freq: "weekly", byWeekday: [1] } });
    expect(next.startAt).toBe("2026-06-14T09:00:00.000Z");
  });
});

describe("setTaskTurn", () => {
  it("sets running turn and stamps turnAt/updatedAt while normalizing legacy task defaults", async () => {
    type LegacyTask = Omit<Task, "scheduledAt" | "subtasks" | "completedCount" | "turn" | "turnAt">;
    const legacyTask: LegacyTask = {
      id: "legacy-task",
      title: "接手旧任务",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      sortOrder: 0,
      createdAt: "2026-06-14T08:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    };
    await db.tasks.put(legacyTask as Task);

    const next = await setTaskTurn("legacy-task", "running", { now: new Date("2026-06-14T09:00:00.000Z") });

    expect(next).toMatchObject({
      id: "legacy-task",
      turn: "running",
      turnAt: "2026-06-14T09:00:00.000Z",
      updatedAt: "2026-06-14T09:00:00.000Z",
      scheduledAt: null,
      subtasks: [],
      completedCount: 0,
    });
    await expect(db.tasks.get("legacy-task")).resolves.toMatchObject({
      turn: "running",
      turnAt: "2026-06-14T09:00:00.000Z",
      updatedAt: "2026-06-14T09:00:00.000Z",
    });
    await expect(db.syncLog.where("recordId").equals("legacy-task").toArray()).resolves.toMatchObject([
      { tableName: "tasks", action: "update", timestamp: "2026-06-14T09:00:00.000Z", synced: 0 },
    ]);
  });

  it("clears turnAt when turn is null", async () => {
    const task = await addTask({ title: "轮到我", now: new Date("2026-06-14T08:00:00.000Z") });
    await setTaskTurn(task.id, "me", { now: new Date("2026-06-14T09:00:00.000Z") });

    const cleared = await setTaskTurn(task.id, null, { now: new Date("2026-06-14T10:00:00.000Z") });

    expect(cleared.turn).toBeNull();
    expect(cleared.turnAt).toBeNull();
    expect(cleared.updatedAt).toBe("2026-06-14T10:00:00.000Z");
  });

  it("throws when the task does not exist", async () => {
    await expect(setTaskTurn("missing-task", "parked")).rejects.toThrow("任务不存在");
  });
});

describe("deleteTask", () => {
  it("deletes the task and writes a delete syncLog", async () => {
    const task = await addTask({ title: "bye" });

    await deleteTask(task.id);

    await expect(db.tasks.get(task.id)).resolves.toBeUndefined();
    await expect(db.syncLog.where("recordId").equals(task.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "delete" })]),
    );
  });
});

describe("scheduleTask / unscheduleTask", () => {
  it("scheduleTask 写未来日期 → upcoming", async () => {
    const t = await addTask({ title: "圣诞", toInbox: true });
    const next = await scheduleTask(t.id, "2026-12-25");
    expect(next.scheduledAt).toBe(localDateOf(new Date(2026, 11, 25)));
  });

  it("unscheduleTask → scheduledAt=null（普通任务）", async () => {
    const t = await addTask({ title: "x" });
    const next = await unscheduleTask(t.id);
    expect(next.scheduledAt).toBeNull();
  });

  it("unscheduleTask 重复任务抛错", async () => {
    const t = await addTask({ title: "刮胡子", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await expect(unscheduleTask(t.id)).rejects.toThrow();
  });
});

describe("listTasks", () => {
  it("分区：今天、inbox、重复", async () => {
    const now = new Date("2026-06-14T08:00:00.000Z");
    await addTask({ title: "今天", now });
    await addTask({ title: "inbox", toInbox: true, now });
    await addTask({ title: "重复", recurrence: { freq: "daily", interval: 1, basis: "due" }, now });

    const buckets = await listTasks(now);

    // 重复任务今天到期，同时出现在 today 和 recurring
    expect(buckets.today).toHaveLength(2); // "今天" + 重复任务今天到期
    expect(buckets.inbox).toHaveLength(1);
    expect(buckets.recurring).toHaveLength(1);
  });

  it("今天完成的任务进 todayDone 并按 completedAt 倒序", async () => {
    const older = await addTask({ title: "旧完成", toInbox: true });
    const newer = await addTask({ title: "新完成", toInbox: true });
    await toggleTaskDone(older.id, { now: new Date("2026-06-14T08:00:00.000Z") });
    await toggleTaskDone(newer.id, { now: new Date("2026-06-14T09:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.todayDone.map((task) => task.id)).toEqual([newer.id, older.id]);
    expect(buckets.completed).toHaveLength(0);
  });

  it("todayDone 使用应用本地日界判断完成日", async () => {
    const task = await addTask({ title: "本地凌晨完成", toInbox: true });
    await toggleTaskDone(task.id, { now: new Date("2026-06-13T16:30:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T01:00:00.000Z"));

    expect(buckets.todayDone.map((item) => item.id)).toEqual([task.id]);
    expect(buckets.completed).toHaveLength(0);
  });

  it("隔日完成进 completed、不进 todayDone", async () => {
    const task = await addTask({ title: "昨天完成", toInbox: true });
    await toggleTaskDone(task.id, { now: new Date("2026-06-13T10:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.completed.map((item) => item.id)).toEqual([task.id]);
    expect(buckets.todayDone.map((item) => item.id)).not.toContain(task.id);
  });

  it("重复任务完成不进 todayDone", async () => {
    const task = await addTask({
      title: "只重复一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: new Date("2026-06-14T07:00:00.000Z"),
    });
    await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.todayDone.map((item) => item.id)).not.toContain(task.id);
  });
});

describe("persistTaskOrder", () => {
  it("按新顺序回填槽位并写 syncLog", async () => {
    const t0 = new Date("2026-06-14T08:00:00.000Z");
    const a = await addTask({ title: "A", now: t0 });
    const b = await addTask({ title: "B", now: t0 });
    const c = await addTask({ title: "C", now: t0 });
    await db.syncLog.clear();

    await persistTaskOrder([c.id, a.id, b.id]);

    const after = await db.tasks.orderBy("sortOrder").toArray();
    expect(after.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    const logs = await db.syncLog.where("tableName").equals("tasks").toArray();
    expect(logs.every((log) => log.action === "update")).toBe(true);
    expect(logs.length).toBe(3);
  });

  it("顺序不变则不写", async () => {
    const t0 = new Date("2026-06-14T08:00:00.000Z");
    const a = await addTask({ title: "A", now: t0 });
    const b = await addTask({ title: "B", now: t0 });
    await db.syncLog.clear();

    await persistTaskOrder([a.id, b.id]);

    const logs = await db.syncLog.where("tableName").equals("tasks").toArray();
    expect(logs.length).toBe(0);
  });
});
