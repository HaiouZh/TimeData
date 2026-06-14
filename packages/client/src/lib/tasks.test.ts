import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { addTask, deleteTask, listTasks, toggleTaskDone, updateTask } from "./tasks.js";

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
});

describe("toggleTaskDone", () => {
  it("pool task: flips done", async () => {
    const task = await addTask({ title: "x" });

    const done = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(done.done).toBe(true);
    expect(done.lastDoneAt).toBeNull();
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

describe("listTasks", () => {
  it("splits pool and recurring", async () => {
    await addTask({ title: "池" });
    await addTask({ title: "重复", recurrence: { freq: "daily", interval: 1, basis: "due" } });

    const { pool, recurring } = await listTasks();

    expect(pool).toHaveLength(1);
    expect(recurring).toHaveLength(1);
  });
});
