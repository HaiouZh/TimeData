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
    const task = await addTask({
      title: "跑步",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });

    const after = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(after.lastDoneAt).toBe("2026-06-14T08:00:00.000Z");
    expect(after.done).toBe(false);
  });

  it("重复任务非终结完成：衍生一条已完成快照 + 写 create syncLog", async () => {
    const task = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });
    const before = await db.tasks.count();

    const advanced = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(advanced).toMatchObject({
      id: task.id,
      done: false,
      completedCount: 1,
      lastDoneAt: "2026-06-14T08:00:00.000Z",
    });
    expect(await db.tasks.count()).toBe(before + 1);
    const occ = (await db.tasks.toArray()).find((t) => t.id !== task.id && t.title === "喝水");
    expect(occ).toMatchObject({ done: true, recurrence: null, completedAt: "2026-06-14T08:00:00.000Z" });
    await expect(db.syncLog.where("recordId").equals(occ!.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "create" })]),
    );
  });

  it("重复任务未终结完成：子任务重置为未完成", async () => {
    const t = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });
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

  it("今天完成 + 隔日完成都进 completed，按 completedAt 倒序", async () => {
    const older = await addTask({ title: "老", toInbox: true });
    const newer = await addTask({ title: "新", toInbox: true });
    const prev = await addTask({ title: "昨", toInbox: true });
    await toggleTaskDone(older.id, { now: new Date("2026-06-14T08:00:00.000Z") });
    await toggleTaskDone(newer.id, { now: new Date("2026-06-14T09:00:00.000Z") });
    await toggleTaskDone(prev.id, { now: new Date("2026-06-13T10:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.completed.map((t) => t.id)).toEqual([newer.id, older.id, prev.id]);
  });

  it("重复任务完成：模板留在循环、衍生条进 completed", async () => {
    const task = await addTask({
      title: "跑步",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });
    await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    // 模板本身不在 completed（仍是重复，落 today/scheduled）
    expect(buckets.completed.map((t) => t.id)).not.toContain(task.id);
    // 衍生出一条独立完成记录（新 id、标题快照），进 completed
    const occ = buckets.completed.find((t) => t.title === "跑步" && t.id !== task.id);
    expect(occ).toBeDefined();
    expect(occ).toMatchObject({ done: true, recurrence: null, completedAt: "2026-06-14T08:00:00.000Z" });
  });

  it("耗尽重复（count 满）就地转化进 completed，写 completedAt 并按时间排序", async () => {
    const t0 = new Date("2026-06-14T06:00:00.000Z");
    const regular = await addTask({ title: "普通", toInbox: true, now: t0 });
    await toggleTaskDone(regular.id, { now: new Date("2026-06-14T08:00:00.000Z") });
    const oneShot = await addTask({
      title: "做一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: t0,
    });
    await toggleTaskDone(oneShot.id, { now: new Date("2026-06-14T09:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    // 就地转化：原 id 进 completed、写了 completedAt
    const oneShotAfter = buckets.completed.find((t) => t.id === oneShot.id);
    expect(oneShotAfter?.completedAt).toBe("2026-06-14T09:00:00.000Z");
    // 按 completedAt 倒序：oneShot(09:00) 在 regular(08:00) 之前
    expect(buckets.completed[0]?.id).toBe(oneShot.id);
    expect(buckets.completed.map((t) => t.id)).toContain(regular.id);
  });

  it("一次性未来排期 + 未到期重复都进 scheduled，按到期日升序", async () => {
    const seedNow = new Date("2026-06-14T06:00:00.000Z");
    const far = await addTask({ title: "远", toInbox: true, now: seedNow });
    await scheduleTask(far.id, "2026-06-20", { now: seedNow });
    const near = await addTask({ title: "近", toInbox: true, now: seedNow });
    await scheduleTask(near.id, "2026-06-16", { now: seedNow });
    // 未到期重复（startAt 在未来）
    await addTask({
      title: "周计划",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-18T00:00:00.000Z",
      now: seedNow,
    });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.scheduled.map((t) => t.title)).toEqual(["近", "周计划", "远"]);
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
