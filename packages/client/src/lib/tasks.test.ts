import type { Task } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { localDateOf } from "./tasks/placement.js";
import {
  addTask,
  bumpTaskWeight,
  createChildTask,
  deleteTask,
  deleteTaskCascade,
  listTasks,
  markOccurrenceSkipped,
  moveTaskToParent,
  persistTaskOrder,
  promoteToRoot,
  reorderChildren,
  runMaterialization,
  scheduleTask,
  setTaskTags,
  toggleTaskDone,
  unscheduleTask,
  updateTask,
} from "./tasks.js";

beforeEach(resetDb);

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
  });

  it("addTask 放入 inbox 时 scheduledAt=null", async () => {
    const t = await addTask({ title: "收纳", toInbox: true });
    expect(t.scheduledAt).toBeNull();
  });

  it("addTask 传 tags → 新任务带该 tags", async () => {
    const task = await addTask({ title: "带标签", tags: ["工作", "紧急"] });
    expect(task.tags).toEqual(["工作", "紧急"]);
    const stored = await db.tasks.get(task.id);
    expect(stored?.tags).toEqual(["工作", "紧急"]);
  });

  it("addTask 不传 tags → 默认 []", async () => {
    const task = await addTask({ title: "无标签" });
    expect(task.tags).toEqual([]);
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

    expect(after.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 14)));
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
      lastDoneAt: localDateOf(new Date(2026, 5, 14)),
    });
    expect(await db.tasks.count()).toBe(before + 1);
    const occ = (await db.tasks.toArray()).find((t) => t.id !== task.id && t.title === "喝水");
    expect(occ).toMatchObject({ done: true, recurrence: null, completedAt: "2026-06-14T08:00:00.000Z" });
    await expect(db.syncLog.where("recordId").equals(occ!.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "create" })]),
    );
  });

  it("child task toggle ignores dormant recurrence and does not create occurrence", async () => {
    const parent = await addTask({ title: "父任务", now: new Date("2026-06-19T08:00:00.000Z") });
    const child = await createChildTask(parent.id, "子任务", new Date("2026-06-19T08:30:00.000Z"));
    await db.tasks.update(child.id, {
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-19T00:00:00.000Z",
    } satisfies Partial<Task>);
    const beforeCount = await db.tasks.count();

    const done = await toggleTaskDone(child.id, { now: new Date("2026-06-19T09:00:00.000Z") });

    expect(done).toMatchObject({
      id: child.id,
      parentId: parent.id,
      done: true,
      completedAt: "2026-06-19T09:00:00.000Z",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
    });
    expect(await db.tasks.count()).toBe(beforeCount);
    expect(await db.tasks.where("parentId").equals(child.id).count()).toBe(0);
  });

  it("root recurring completion snapshots children and resets template children", async () => {
    const root = await addTask({
      title: "重复父任务",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-19T06:00:00.000Z"),
    });
    const doneChild = await createChildTask(root.id, "已完成子项", new Date("2026-06-19T06:30:00.000Z"));
    await toggleTaskDone(doneChild.id, { now: new Date("2026-06-19T07:00:00.000Z") });
    const todoChild = await createChildTask(root.id, "未完成子项", new Date("2026-06-19T07:30:00.000Z"));

    const next = await toggleTaskDone(root.id, { now: new Date("2026-06-19T08:00:00.000Z") });

    const occurrence = (await db.tasks.toArray()).find((task) => task.id !== root.id && task.title === "重复父任务");
    expect(occurrence).toMatchObject({ done: true, parentId: null, completedAt: "2026-06-19T08:00:00.000Z" });

    const occurrenceChildren = await db.tasks.where("parentId").equals(occurrence!.id).sortBy("sortOrder");
    expect(occurrenceChildren.map((child) => [child.title, child.done, child.completedAt])).toEqual([
      ["已完成子项", true, "2026-06-19T07:00:00.000Z"],
      ["未完成子项", false, null],
    ]);

    const templateChildren = await db.tasks.where("parentId").equals(root.id).sortBy("sortOrder");
    expect(templateChildren.map((child) => [child.id, child.done, child.completedAt])).toEqual([
      [doneChild.id, false, null],
      [todoChild.id, false, null],
    ]);
    expect(next.done).toBe(false);
    expect(next.completedCount).toBe(1);
  });
});

describe("independent child task helpers", () => {
  it("createChildTask validates parent and creates a normalized child", async () => {
    await expect(createChildTask("missing", "子任务")).rejects.toThrow("PARENT_NOT_FOUND");

    const parent = await addTask({ title: "父任务", now: new Date("2026-06-19T08:00:00.000Z") });
    const child = await createChildTask(parent.id, "  子任务  ", new Date("2026-06-19T09:00:00.000Z"));

    expect(child).toMatchObject({
      parentId: parent.id,
      title: "子任务",
      scheduledAt: null,
      recurrence: null,
      tags: [],
      sortOrder: 0,
      createdAt: "2026-06-19T09:00:00.000Z",
      updatedAt: "2026-06-19T09:00:00.000Z",
    });
    await expect(db.syncLog.where("recordId").equals(child.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "create" })]),
    );

    await expect(createChildTask(child.id, "孙任务")).rejects.toThrow("CANNOT_NEST_BEYOND_ONE_LEVEL");
  });

  it("promoteToRoot moves a child to inbox or today while preserving dormant fields", async () => {
    const parent = await addTask({ title: "父任务", now: new Date("2026-06-19T08:00:00.000Z") });
    const child = await createChildTask(parent.id, "子任务", new Date("2026-06-19T09:00:00.000Z"));
    await db.tasks.update(child.id, {
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      tags: ["keep"],
      completedAt: "2026-06-19T09:45:00.000Z",
    } satisfies Partial<Task>);

    const inbox = await promoteToRoot(child.id, "inbox", 7, new Date("2026-06-19T10:00:00.000Z"));
    expect(inbox).toMatchObject({
      parentId: null,
      scheduledAt: null,
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      tags: ["keep"],
      completedAt: "2026-06-19T09:45:00.000Z",
      sortOrder: 7,
      updatedAt: "2026-06-19T10:00:00.000Z",
    });

    await moveTaskToParent(child.id, parent.id, new Date("2026-06-19T10:30:00.000Z"));
    const todayNow = new Date("2026-06-20T11:00:00.000Z");
    const today = await promoteToRoot(child.id, "today", 3, todayNow);
    expect(today.parentId).toBeNull();
    expect(today.scheduledAt).toBe(localDateOf(todayNow));
    expect(today.sortOrder).toBe(3);
  });

  it("moveTaskToParent enforces one level, rejects roots with children, and preserves dormant fields", async () => {
    const parent = await addTask({ title: "父任务", now: new Date("2026-06-19T08:00:00.000Z") });
    const otherRoot = await addTask({ title: "另一个父任务", now: new Date("2026-06-19T08:01:00.000Z") });
    const child = await createChildTask(parent.id, "子任务", new Date("2026-06-19T09:00:00.000Z"));

    await expect(moveTaskToParent(otherRoot.id, child.id)).rejects.toThrow("CANNOT_NEST_BEYOND_ONE_LEVEL");
    await expect(moveTaskToParent(parent.id, otherRoot.id)).rejects.toThrow("CANNOT_DEMOTE_ROOT_WITH_CHILDREN");

    await db.tasks.update(child.id, {
      recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
      scheduledAt: "2026-06-22T00:00:00.000Z",
      lastDoneAt: "2026-06-15T00:00:00.000Z",
      startAt: "2026-06-01T00:00:00.000Z",
      completedCount: 2,
      tags: ["keep"],
      completedAt: "2026-06-19T09:45:00.000Z",
    } satisfies Partial<Task>);

    const moved = await moveTaskToParent(child.id, otherRoot.id, new Date("2026-06-19T10:00:00.000Z"));
    expect(moved).toMatchObject({
      parentId: otherRoot.id,
      sortOrder: 0, // otherRoot 原本无 child，追加到末尾即槽位 0

      recurrence: { freq: "weekly", byWeekday: [1] },
      scheduledAt: "2026-06-22T00:00:00.000Z",
      lastDoneAt: "2026-06-15T00:00:00.000Z",
      startAt: "2026-06-01T00:00:00.000Z",
      completedCount: 2,
      tags: ["keep"],
      completedAt: "2026-06-19T09:45:00.000Z",
    });
  });

  it("moveTaskToParent 追加到目标父现有 children 末尾、不撞值", async () => {
    const t0 = new Date("2026-06-19T08:00:00.000Z");
    const parent = await addTask({ title: "父", now: t0 });
    await createChildTask(parent.id, "已有1", t0); // sortOrder 0
    await createChildTask(parent.id, "已有2", t0); // sortOrder 1
    const root = await addTask({ title: "待降级", now: t0 });

    const moved = await moveTaskToParent(root.id, parent.id, t0);

    expect(moved.parentId).toBe(parent.id);
    expect(moved.sortOrder).toBe(2); // 追加到末尾，与现有 0/1 不撞值
    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it("deleteTaskCascade deletes a parent and direct children with sync logs", async () => {
    const parent = await addTask({ title: "父任务" });
    const childA = await createChildTask(parent.id, "A");
    const childB = await createChildTask(parent.id, "B");
    await db.syncLog.clear();

    await deleteTaskCascade(parent.id);

    await expect(db.tasks.bulkGet([parent.id, childA.id, childB.id])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const logs = await db.syncLog.where("tableName").equals("tasks").toArray();
    expect(logs.map((log) => [log.recordId, log.action])).toEqual(
      expect.arrayContaining([
        [parent.id, "delete"],
        [childA.id, "delete"],
        [childB.id, "delete"],
      ]),
    );
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

  it("UNTIL：过期时逐次追平，到 until 当天才 done 翻真", async () => {
    const t = await addTask({
      title: "到月中",
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-02T00:00:00.000Z" },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    const first = await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    expect(first.done).toBe(false);
    expect(first.recurrence).not.toBeNull();
    expect(first.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 1)));

    const done = await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    expect(done.done).toBe(true);
    expect(done.recurrence).toBeNull();
    expect(done.lastDoneAt).toBe(localDateOf(new Date(2026, 5, 2)));
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

  it("resets the old recurrence cursor when the recurrence rule is re-anchored", async () => {
    const task = await addTask({
      title: "old",
      recurrence: { freq: "daily", interval: 2, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 20)),
      now: new Date("2026-06-20T08:00:00.000Z"),
    });
    await db.tasks.update(task.id, {
      lastDoneAt: localDateOf(new Date(2026, 5, 24)),
      completedCount: 2,
    } satisfies Partial<Task>);

    const next = await updateTask(task.id, {
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 27)),
      now: new Date("2026-06-27T08:00:00.000Z"),
    });

    expect(next).toMatchObject({
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 27)),
      lastDoneAt: null,
      completedCount: 0,
    });
  });

  it("keeps recurrence progress when saving an unchanged recurrence rule", async () => {
    const recurrence = { freq: "daily", interval: 2, basis: "due" } as const;
    const startAt = localDateOf(new Date(2026, 5, 20));
    const task = await addTask({
      title: "old",
      recurrence,
      startAt,
      now: new Date("2026-06-20T08:00:00.000Z"),
    });
    await db.tasks.update(task.id, {
      lastDoneAt: localDateOf(new Date(2026, 5, 24)),
      completedCount: 2,
    } satisfies Partial<Task>);

    const next = await updateTask(task.id, {
      recurrence: { ...recurrence },
      startAt,
      now: new Date("2026-06-27T08:00:00.000Z"),
    });

    expect(next).toMatchObject({
      lastDoneAt: localDateOf(new Date(2026, 5, 24)),
      completedCount: 2,
    });
  });

  it("keeps recurrence progress when unchanged recurrence fields arrive in a different order", async () => {
    const task = await addTask({
      title: "old",
      recurrence: { freq: "daily", interval: 2, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 20)),
      now: new Date("2026-06-20T08:00:00.000Z"),
    });
    await db.tasks.update(task.id, {
      lastDoneAt: localDateOf(new Date(2026, 5, 24)),
      completedCount: 2,
    } satisfies Partial<Task>);

    const next = await updateTask(task.id, {
      recurrence: { basis: "due", interval: 2, freq: "daily" },
      startAt: localDateOf(new Date(2026, 5, 20)),
      now: new Date("2026-06-27T08:00:00.000Z"),
    });

    expect(next).toMatchObject({
      lastDoneAt: localDateOf(new Date(2026, 5, 24)),
      completedCount: 2,
    });
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
  it("读取剥掉孤儿字段", async () => {
    await db.tasks.put({
      id: "task-ghost",
      parentId: null,
      title: "旧任务",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: localDateOf(new Date("2026-06-20T08:00:00.000Z")),
      completedCount: 0,
      completedAt: null,
      tags: [],
      sortOrder: 0,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ghostField: "strip-me",
    } as never);

    const buckets = await listTasks(new Date("2026-06-20T08:00:00.000Z"));

    expect(buckets.today).toHaveLength(1);
    expect(buckets.today[0]).not.toHaveProperty("ghostField");
  });

  it("遇不可解析行 -> warn + 跳过，不抛", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 带 sortOrder 才会被 orderBy("sortOrder") 索引遍历到（IndexedDB 稀疏索引跳过缺该键的行）。
    await db.tasks.put({ id: "bad-task", sortOrder: 0 } as never);

    const buckets = await listTasks(new Date("2026-06-20T08:00:00.000Z"));

    expect([...buckets.today, ...buckets.inbox, ...buckets.scheduled, ...buckets.completed]).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("分区：今天、inbox、重复模板进 scheduled", async () => {
    const now = new Date("2026-06-14T08:00:00.000Z");
    await addTask({ title: "今天", now });
    await addTask({ title: "inbox", toInbox: true, now });
    await addTask({ title: "重复", recurrence: { freq: "daily", interval: 1, basis: "due" }, now });

    const buckets = await listTasks(now);

    // P3 后模板不投影 today，只进 scheduled；recurring 保留空桶兼容
    expect(buckets.today).toHaveLength(1); // 仅 "今天"
    expect(buckets.inbox).toHaveLength(1);
    expect(buckets.recurring).toHaveLength(0);
    expect(buckets.scheduled.some((t) => t.title === "重复")).toBe(true);
  });

  it("带休眠 recurrence 的 child 不进入任何 listTasks bucket", async () => {
    const now = new Date("2026-06-19T08:00:00.000Z");
    const root = await addTask({ title: "父任务", now });
    const child = await createChildTask(root.id, "休眠重复子项", now);
    await db.tasks.update(child.id, {
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-19T00:00:00.000Z",
    } satisfies Partial<Task>);

    const buckets = await listTasks(now);
    const bucketIds = [
      ...buckets.today,
      ...buckets.inbox,
      ...buckets.scheduled,
      ...buckets.recurring,
      ...buckets.completed,
    ].map((task) => task.id);

    expect(bucketIds).not.toContain(child.id);
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

describe("reorderChildren", () => {
  it("把子任务移到新位置并持久化 sortOrder", async () => {
    const t0 = new Date("2026-06-14T08:00:00.000Z");
    const parent = await addTask({ title: "父", now: t0 });
    const a = await createChildTask(parent.id, "a", t0);
    const b = await createChildTask(parent.id, "b", t0);
    const c = await createChildTask(parent.id, "c", t0);
    await db.syncLog.clear();

    // 把 c（末位）拖到 a（首位）的位置
    await reorderChildren(parent.id, c.id, a.id);

    const after = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(after.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    const logs = await db.syncLog.where("tableName").equals("tasks").toArray();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((log) => log.action === "update")).toBe(true);
  });

  it("拖到原位置不写库", async () => {
    const parent = await addTask({ title: "父" });
    const a = await createChildTask(parent.id, "a");
    await createChildTask(parent.id, "b");
    await db.syncLog.clear();

    await reorderChildren(parent.id, a.id, a.id);

    const logs = await db.syncLog.where("tableName").equals("tasks").toArray();
    expect(logs.length).toBe(0);
  });

  it("子任务 sortOrder 撞同值（历史脏数据/跨端同步）也能重排并自愈", async () => {
    const t0 = new Date("2026-06-14T08:00:00.000Z");
    const parent = await addTask({ title: "父", now: t0 });
    const a = await createChildTask(parent.id, "a", t0);
    const b = await createChildTask(parent.id, "b", t0);
    const c = await createChildTask(parent.id, "c", t0);
    // 直接写库模拟历史脏数据：三条子任务 sortOrder 全撞 0（旧 moveTaskToParent 塞 0 或跨端同步撞值的产物）
    await db.tasks.bulkUpdate([a, b, c].map((t) => ({ key: t.id, changes: { sortOrder: 0 } })));
    await db.syncLog.clear();

    // 初始 sortOrder 全 0：按 sortOrder 取出的次序由主键并列兜底，先读出再据此构造期望，避免依赖 uuid 顺序
    const before = (await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder")).map((t) => t.id);
    const [first, , last] = before;

    // 把末位子任务拖到首位
    await reorderChildren(parent.id, last, first);

    const after = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    // 末位被移到首位，其余保持原相对次序
    expect(after.map((t) => t.id)).toEqual([last, ...before.filter((id) => id !== last)]);
    // sortOrder 已被回填成连续 distinct 值（自愈撞值脏数据），否则下次还是拖不动
    expect(after.map((t) => t.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("bumpTaskWeight", () => {
  it("increments weight and writes a task sync log", async () => {
    const created = await addTask({ title: "旧想法", toInbox: true, now: new Date("2026-06-01T00:00:00.000Z") });

    const updated = await bumpTaskWeight(created.id, { now: new Date("2026-06-28T12:00:00.000Z") });

    expect(updated.weight).toBe(1);
    expect(updated.updatedAt).toBe("2026-06-28T12:00:00.000Z");
    const logs = await db.syncLog.where("recordId").equals(created.id).toArray();
    expect(logs.some((log) => log.action === "update")).toBe(true);
  });

  it("preserves existing fields when incrementing weight", async () => {
    const task = await addTask({
      title: "带标签想法",
      toInbox: true,
      tags: ["实验"],
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    const updated = await bumpTaskWeight(task.id, { now: new Date("2026-06-28T12:00:00.000Z") });

    expect(updated).toMatchObject({
      id: task.id,
      title: "带标签想法",
      tags: ["实验"],
      weight: 1,
    });
  });
});

describe("markOccurrenceSkipped", () => {
  it("occurrence 置 skipped=true + 写 update syncLog", async () => {
    await db.tasks.add({
      id: "occ:r1:2026-06-14", parentId: null, title: "补铁", done: false, recurrence: null,
      lastDoneAt: null, startAt: null, scheduledAt: "2026-06-14T00:00:00.000Z", completedCount: 0,
      weight: 0, completedAt: null, tags: [], ruleId: "r1", skipped: false, sortOrder: 0,
      createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
    });
    await markOccurrenceSkipped("occ:r1:2026-06-14", { now: new Date("2026-06-14T09:00:00.000Z") });
    expect((await db.tasks.get("occ:r1:2026-06-14"))?.skipped).toBe(true);
    await expect(db.syncLog.where("recordId").equals("occ:r1:2026-06-14").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "update" })]),
    );
  });
  it("对非 occurrence（ruleId=null）抛错", async () => {
    const t = await addTask({ title: "普通" });
    await expect(markOccurrenceSkipped(t.id)).rejects.toThrow();
  });
});

describe("runMaterialization", () => {
  it("到期 rule 物化一条 pending occurrence 进库", async () => {
    const rule = await addTask({
      title: "喝水", recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 14)), now: new Date("2026-06-14T06:00:00.000Z"),
    });
    await runMaterialization(new Date("2026-06-14T08:00:00.000Z"));
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped);
    expect(occ).toMatchObject({ ruleId: rule.id, recurrence: null, done: false, skipped: false, scheduledAt: localDateOf(new Date(2026, 5, 14)) });
    await expect(db.syncLog.where("recordId").equals(occ!.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "create" })]),
    );
  });
  it("已有活跃 pending 时不重复物化（幂等）", async () => {
    const rule = await addTask({ title: "喝水", recurrence: { freq: "daily", interval: 1, basis: "due" }, startAt: localDateOf(new Date(2026, 5, 14)), now: new Date("2026-06-14T06:00:00.000Z") });
    await runMaterialization(new Date("2026-06-14T08:00:00.000Z"));
    const before = await db.tasks.count();
    await runMaterialization(new Date("2026-06-14T10:00:00.000Z"));
    expect(await db.tasks.count()).toBe(before);
  });
  it("并发触发也只物化一条 pending occurrence", async () => {
    const rule = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 14)),
      now: new Date("2026-06-14T06:00:00.000Z"),
    });

    await Promise.all([
      runMaterialization(new Date("2026-06-14T08:00:00.000Z")),
      runMaterialization(new Date("2026-06-14T08:00:00.000Z")),
    ]);

    const active = (await db.tasks.where("ruleId").equals(rule.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(active).toHaveLength(1);
  });
});

describe("listTasks occurrence 切读", () => {
  it("occurrence 进 today、模板不进 today（进 scheduled）", async () => {
    const rule = await addTask({ title: "喝水", recurrence: { freq: "daily", interval: 1, basis: "due" }, startAt: localDateOf(new Date(2026, 5, 14)), now: new Date("2026-06-14T06:00:00.000Z") });
    await runMaterialization(new Date("2026-06-14T08:00:00.000Z"));
    const b = await listTasks(new Date("2026-06-14T08:00:00.000Z"));
    // 模板不在 today
    expect(b.today.some((t) => t.id === rule.id)).toBe(false);
    // occurrence 在 today
    expect(b.today.some((t) => t.ruleId === rule.id)).toBe(true);
    // 模板在 scheduled 管理区
    expect(b.scheduled.some((t) => t.id === rule.id)).toBe(true);
  });
  it("skipped occurrence 不进 today/inbox", async () => {
    await db.tasks.add({
      id: "occ:r1:2026-06-14", parentId: null, title: "补铁", done: false, recurrence: null,
      lastDoneAt: null, startAt: null, scheduledAt: "2026-06-14T00:00:00.000Z", completedCount: 0,
      weight: 0, completedAt: null, tags: [], ruleId: "r1", skipped: true, sortOrder: 0,
      createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
    });
    const b = await listTasks(new Date("2026-06-14T08:00:00.000Z"));
    expect(b.today.some((t) => t.id === "occ:r1:2026-06-14")).toBe(false);
    expect(b.inbox.some((t) => t.id === "occ:r1:2026-06-14")).toBe(false);
  });
});
