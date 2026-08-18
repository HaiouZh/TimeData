import { occurrenceId, type Task } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addGoal, addGoalMember } from "./goals.js";
import { endActiveSession, grabTaskToHand } from "./sessions.js";
import { occurrenceChildId } from "./tasks/occurrenceChildId.js";
import { localDateOf } from "./tasks/placement.js";
import { addTaskRelation } from "./taskRelations.js";
import {
  addTask,
  applyRecurrenceChoice,
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
    const logs = await db.syncLog.where("recordId").equals(task.id).toArray();
    const updates = logs.filter((log) => log.action === "update").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    expect(updates).toEqual([
      expect.objectContaining({ tableName: "tasks", action: "update", op: { type: "complete", at: "2026-06-14T08:00:00.000Z" } }),
      expect.objectContaining({ tableName: "tasks", action: "update", op: { type: "reopen", at: "2026-06-14T09:00:00.000Z" } }),
    ]);
  });

  it("规则模板子任务：勾选写到最新非 skipped occurrence 子任务，模板子任务不变", async () => {
    const now = new Date("2026-07-03T08:00:00.000Z");
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 1)),
      now,
    });
    const templateChild = await createChildTask(rule.id, "补铁", now);
    await runMaterialization(new Date("2026-07-01T08:00:00.000Z"));
    const first = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(first.id, { now: new Date("2026-07-03T08:30:00.000Z") });
    const latest = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;

    const updated = await toggleTaskDone(templateChild.id, { now: new Date("2026-07-03T09:00:00.000Z") });

    expect(updated.id).toBe(occurrenceChildId(latest.id, templateChild.id));
    await expect(db.tasks.get(templateChild.id)).resolves.toMatchObject({ done: false, completedAt: null });
    await expect(db.tasks.get(occurrenceChildId(latest.id, templateChild.id))).resolves.toMatchObject({
      done: true,
      completedAt: "2026-07-03T09:00:00.000Z",
    });
    await expect(db.syncLog.where("recordId").equals(occurrenceChildId(latest.id, templateChild.id)).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "update" })]),
    );
  });

  it("规则模板子任务：无 active 时写到最新 done occurrence 子任务", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 1)),
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const templateChild = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await runMaterialization(new Date("2026-07-01T08:20:00.000Z"));
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occ.id, { now: new Date("2026-07-01T09:00:00.000Z") });

    const updated = await toggleTaskDone(templateChild.id, { now: new Date("2026-07-01T10:00:00.000Z") });

    expect(updated.id).toBe(occurrenceChildId(occ.id, templateChild.id));
    await expect(db.tasks.get(occurrenceChildId(occ.id, templateChild.id))).resolves.toMatchObject({ done: true });
    await expect(db.tasks.get(templateChild.id)).resolves.toMatchObject({ done: false });
  });

  it("规则模板子任务：目标 occurrence 子任务缺失时按确定性 id 兜底创建并写 syncLog", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 1)),
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const templateChild = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await runMaterialization(new Date("2026-07-01T08:20:00.000Z"));
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    const targetId = occurrenceChildId(occ.id, templateChild.id);
    await db.tasks.delete(targetId);
    await db.syncLog.clear();

    const updated = await toggleTaskDone(templateChild.id, { now: new Date("2026-07-01T09:00:00.000Z") });

    expect(updated.id).toBe(targetId);
    await expect(db.tasks.get(targetId)).resolves.toMatchObject({
      id: targetId,
      parentId: occ.id,
      title: "补铁",
      done: true,
      completedAt: "2026-07-01T09:00:00.000Z",
      tags: [],
    });
    await expect(db.syncLog.where("recordId").equals(targetId).toArray()).resolves.toEqual([
      expect.objectContaining({ action: "create", timestamp: "2026-07-01T09:00:00.000Z" }),
    ]);
  });

  it("规则模板子任务：无可映射 occurrence 时不写库也不改模板", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const templateChild = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await db.syncLog.clear();

    const updated = await toggleTaskDone(templateChild.id, { now: new Date("2026-07-01T09:00:00.000Z") });

    expect(updated.id).toBe(templateChild.id);
    await expect(db.tasks.get(templateChild.id)).resolves.toMatchObject({ done: false, completedAt: null });
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
  });

  it("重复模板 root：完成代理到最新一发，模板本体不动（§9.2）", async () => {
    const task = await addTask({
      title: "跑步",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });

    const after = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(after.id).not.toBe(task.id);
    expect(after).toMatchObject({ ruleId: task.id, done: true, completedAt: "2026-06-14T08:00:00.000Z" });
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({ done: false, lastDoneAt: null, completedCount: 0 });
  });

  it("重复模板 root 无 active：先物化再完成，产出确定性 id occurrence + create syncLog", async () => {
    const task = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-14T06:00:00.000Z"),
    });
    const before = await db.tasks.count();

    const occ = await toggleTaskDone(task.id, { now: new Date("2026-06-14T08:00:00.000Z") });

    expect(occ.id.startsWith(`occ:${task.id}:`)).toBe(true); // 确定性 id，非随机 uuid
    expect(occ).toMatchObject({ done: true, recurrence: null, completedAt: "2026-06-14T08:00:00.000Z" });
    expect(await db.tasks.count()).toBe(before + 1);
    await expect(db.syncLog.where("recordId").equals(occ.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "create" })]),
    );
  });

  it("未到期 due 规则 root：提前物化下一发并完成，游标仍按应发生日推进", async () => {
    const task = await addTask({
      title: "周五整理",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });

    const occ = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });

    expect(occ).toMatchObject({
      id: occurrenceId(task.id, "2026-07-10"),
      ruleId: task.id,
      done: true,
      scheduledAt: localDateOf(new Date(2026, 6, 10)),
      completedAt: "2026-07-08T09:00:00.000Z",
    });
    const buckets = await listTasks(new Date("2026-07-08T10:00:00.000Z"));
    expect(buckets.scheduled.find((t) => t.id === task.id)?.id).toBe(task.id);
  });

  it("未到期 completion 规则 root：提前完成后按实际完成时刻推进整条链", async () => {
    const task = await addTask({
      title: "间隔三天",
      recurrence: { freq: "daily", interval: 3, basis: "completion" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });

    const first = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });
    const second = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:05:00.000Z") });

    expect(first).toMatchObject({
      id: occurrenceId(task.id, "2026-07-10"),
      done: true,
      scheduledAt: localDateOf(new Date(2026, 6, 10)),
      completedAt: "2026-07-08T09:00:00.000Z",
    });
    expect(second).toMatchObject({
      id: occurrenceId(task.id, "2026-07-11"),
      done: true,
      scheduledAt: localDateOf(new Date(2026, 6, 11)),
      completedAt: "2026-07-08T09:05:00.000Z",
    });
  });

  it("未到期 due 规则 root 连点两下：连续消耗两发", async () => {
    const task = await addTask({
      title: "每周五",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });

    const first = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });
    const second = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:05:00.000Z") });

    expect(first.id).toBe(occurrenceId(task.id, "2026-07-10"));
    expect(second.id).toBe(occurrenceId(task.id, "2026-07-17"));
    const done = (await db.tasks.where("ruleId").equals(task.id).toArray()).filter((o) => o.done);
    expect(done.map((o) => o.scheduledAt)).toEqual([
      localDateOf(new Date(2026, 6, 10)),
      localDateOf(new Date(2026, 6, 17)),
    ]);
  });

  it("未到期 count 规则提前点到耗尽：模板沉入完成区", async () => {
    const task = await addTask({
      title: "做两次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 2 },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });

    await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });
    await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:05:00.000Z") });

    const buckets = await listTasks(new Date("2026-07-08T10:00:00.000Z"));
    expect(buckets.completed.map((t) => t.id)).toContain(task.id);
    expect(buckets.scheduled.map((t) => t.id)).not.toContain(task.id);
  });

  it("提前完成后撤勾 occurrence：游标回退并清掉推进出的 active", async () => {
    const task = await addTask({
      title: "每周五",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });
    const first = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });
    const second = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:05:00.000Z") });

    const reopened = await toggleTaskDone(second.id, { now: new Date("2026-07-08T09:10:00.000Z") });

    expect(reopened).toMatchObject({ id: second.id, done: false, completedAt: null });
    await expect(db.tasks.get(first.id)).resolves.toMatchObject({ done: true });
    const actives = (await db.tasks.where("ruleId").equals(task.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(actives.map((o) => o.id)).toEqual([second.id]);
  });

  it("未到期 until 规则提前完成最后一发后耗尽", async () => {
    const task = await addTask({
      title: "到一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", until: localDateOf(new Date(2026, 6, 10)) },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });

    const occ = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });

    expect(occ.id).toBe(occurrenceId(task.id, "2026-07-10"));
    const buckets = await listTasks(new Date("2026-07-08T10:00:00.000Z"));
    expect(buckets.completed.map((t) => t.id)).toContain(task.id);
  });

  it("提前完成后到期日再物化：确定性 id 幂等，不产生第二发", async () => {
    const task = await addTask({
      title: "周五整理",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 10)),
      now: new Date("2026-07-04T08:00:00.000Z"),
    });
    const occ = await toggleTaskDone(task.id, { now: new Date("2026-07-08T09:00:00.000Z") });

    await runMaterialization(new Date("2026-07-10T09:00:00.000Z"));

    const occurrences = await db.tasks.where("ruleId").equals(task.id).toArray();
    expect(occ.id).toBe(occurrenceId(task.id, "2026-07-10"));
    expect(occurrences.filter((o) => o.id === occ.id)).toHaveLength(1);
    expect(occurrences.filter((o) => o.scheduledAt === localDateOf(new Date(2026, 6, 10)))).toHaveLength(1);
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

  it("重复模板 root 完成：物化的 occurrence children 从未完成起步，模板 children 不动", async () => {
    const root = await addTask({
      title: "重复父任务",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-06-19T06:00:00.000Z"),
    });
    const doneChild = await createChildTask(root.id, "已完成子项", new Date("2026-06-19T06:30:00.000Z"));
    await toggleTaskDone(doneChild.id, { now: new Date("2026-06-19T07:00:00.000Z") }); // 无 occurrence → no-op
    const todoChild = await createChildTask(root.id, "未完成子项", new Date("2026-06-19T07:30:00.000Z"));

    const next = await toggleTaskDone(root.id, { now: new Date("2026-06-19T08:00:00.000Z") });

    expect(next).toMatchObject({ ruleId: root.id, done: true, parentId: null, completedAt: "2026-06-19T08:00:00.000Z" });

    const occurrenceChildren = await db.tasks.where("parentId").equals(next.id).sortBy("sortOrder");
    expect(occurrenceChildren.map((child) => [child.title, child.done, child.completedAt])).toEqual([
      ["已完成子项", false, null],
      ["未完成子项", false, null],
    ]);

    const templateChildren = await db.tasks.where("parentId").equals(root.id).sortBy("sortOrder");
    expect(templateChildren.map((child) => [child.id, child.done, child.completedAt])).toEqual([
      [doneChild.id, false, null],
      [todoChild.id, false, null],
    ]);
    await expect(db.tasks.get(root.id)).resolves.toMatchObject({ done: false, completedCount: 0 });
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

  it("deleteTaskCascade 打 user/cascade 死因标记", async () => {
    const parent = await addTask({ title: "父任务" });
    const child = await createChildTask(parent.id, "子任务");
    await db.syncLog.clear();

    await deleteTaskCascade(parent.id);

    const logs = await db.syncLog.filter((l) => l.action === "delete").toArray();
    expect(logs.find((l) => l.recordId === parent.id)?.deleteReason).toBe("user");
    expect(logs.find((l) => l.recordId === child.id)?.deleteReason).toBe("cascade");
  });
});

describe("终止式重复 toggle", () => {
  it("COUNT 满 → 账本判耗尽，模板沉入 completed 桶", async () => {
    const t = await addTask({
      title: "做三次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 3 },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    await toggleTaskDone(t.id, { now: new Date("2026-06-01T09:00:00.000Z") });
    await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    const occ3 = await toggleTaskDone(t.id, { now: new Date("2026-06-03T09:00:00.000Z") });
    expect(occ3).toMatchObject({ ruleId: t.id, done: true });

    const doneOccs = (await db.tasks.where("ruleId").equals(t.id).toArray()).filter((o) => o.done);
    expect(doneOccs).toHaveLength(3);
    const buckets = await listTasks(new Date("2026-06-03T10:00:00.000Z"));
    expect(buckets.completed.map((x) => x.id)).toContain(t.id); // 耗尽 → completed
    expect(buckets.scheduled.map((x) => x.id)).not.toContain(t.id);
    // 耗尽后再勾 → 无可完成，no-op 返回模板本体
    const noop = await toggleTaskDone(t.id, { now: new Date("2026-06-04T09:00:00.000Z") });
    expect(noop).toMatchObject({ id: t.id, done: false });
  });

  it("UNTIL：过期时逐次追平，补完最后一发后账本判耗尽", async () => {
    const t = await addTask({
      title: "到月中",
      recurrence: { freq: "daily", interval: 1, basis: "due", until: "2026-06-02T00:00:00.000Z" },
      now: new Date("2026-06-01T08:00:00.000Z"),
    });
    const first = await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    expect(first).toMatchObject({ ruleId: t.id, done: true }); // 逐次追平：先补最早那发
    expect(first.scheduledAt).toBe(localDateOf(new Date(2026, 5, 1)));

    const second = await toggleTaskDone(t.id, { now: new Date("2026-06-02T09:00:00.000Z") });
    expect(second).toMatchObject({ ruleId: t.id, done: true });
    expect(second.scheduledAt).toBe(localDateOf(new Date(2026, 5, 2)));
    const buckets = await listTasks(new Date("2026-06-02T10:00:00.000Z"));
    expect(buckets.completed.map((x) => x.id)).toContain(t.id); // until 过 → 耗尽沉底
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

  it("普通任务改成今天命中的重复规则后立即物化 pending occurrence", async () => {
    const now = new Date("2026-07-01T09:00:00.000Z"); // 周三
    const task = await addTask({ title: "每周三", toInbox: true, now: new Date("2026-07-01T08:00:00.000Z") });

    await updateTask(task.id, {
      recurrence: { freq: "weekly", interval: 1, byWeekday: [3], basis: "due" },
      startAt: localDateOf(now),
      now,
    });

    const active = (await db.tasks.where("ruleId").equals(task.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      title: "每周三",
      recurrence: null,
      scheduledAt: localDateOf(now),
      ruleId: task.id,
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

  it("排期通道拒绝 occurrence（这一发不走通用排期）", async () => {
    const rule = await addTask({ title: "每天", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await runMaterialization(new Date());
    const occ = (await db.tasks.toArray()).find((t) => t.ruleId === rule.id && t.recurrence === null);
    expect(occ).toBeDefined();
    await expect(scheduleTask(occ!.id, "2026-08-01")).rejects.toThrow();
    await expect(unscheduleTask(occ!.id)).rejects.toThrow();
    // 拒绝后原值不动
    expect((await db.tasks.get(occ!.id))?.scheduledAt).toBe(occ!.scheduledAt);
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

  // 阶段3 放宽子任务早退后本条改口径：这是一条 **UI 造不出的脏数据**（子任务带 recurrence，
  // 只能像下面这样绕过 API 直接写库），原先它整行消失。现在它按自身状态走重复模板分支进
  // scheduled 管理区——脏数据可见好过静默消失。守的核心不变：**它不占 today 与 inbox**。
  it("带休眠 recurrence 的 child 进 scheduled 管理区，不占 today / inbox", async () => {
    const now = new Date("2026-06-19T08:00:00.000Z");
    const root = await addTask({ title: "父任务", now });
    const child = await createChildTask(root.id, "休眠重复子项", now);
    await db.tasks.update(child.id, {
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-19T00:00:00.000Z",
    } satisfies Partial<Task>);

    const buckets = await listTasks(now);

    expect(buckets.scheduled.map((task) => task.id)).toContain(child.id);
    expect(buckets.today.map((task) => task.id)).not.toContain(child.id);
    expect(buckets.inbox.map((task) => task.id)).not.toContain(child.id);
    expect(buckets.completed.map((task) => task.id)).not.toContain(child.id);
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

  it("耗尽重复（count 满）：模板按账本沉入 completed，完成事实由 occurrence 承载", async () => {
    const t0 = new Date("2026-06-14T06:00:00.000Z");
    const regular = await addTask({ title: "普通", toInbox: true, now: t0 });
    await toggleTaskDone(regular.id, { now: new Date("2026-06-14T08:00:00.000Z") });
    const oneShot = await addTask({
      title: "做一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: t0,
    });
    const occ = await toggleTaskDone(oneShot.id, { now: new Date("2026-06-14T09:00:00.000Z") });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    // 模板（保留 recurrence、completedAt=null）按账本耗尽沉入 completed，排在有 completedAt 的行之后
    expect(buckets.completed.map((t) => t.id)).toContain(oneShot.id);
    expect(buckets.scheduled.map((t) => t.id)).not.toContain(oneShot.id);
    // 完成事实在 occurrence 上；completedAt 倒序：occ(09:00) → regular(08:00) → 模板(null 沉底)
    expect(occ).toMatchObject({ ruleId: oneShot.id, done: true, completedAt: "2026-06-14T09:00:00.000Z" });
    expect(buckets.completed.map((t) => t.id)).toEqual([occ.id, regular.id, oneShot.id]);
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

  it("scheduled 水位线：下一发在 7 天内（含逾期）在水上，更远的给出切点下标", async () => {
    const seedNow = new Date("2026-06-14T06:00:00.000Z");
    const within = await addTask({ title: "七天内", toInbox: true, now: seedNow });
    await scheduleTask(within.id, "2026-06-21", { now: seedNow }); // 今天+7，压线在水上
    const beyond = await addTask({ title: "八天后", toInbox: true, now: seedNow });
    await scheduleTask(beyond.id, "2026-06-22", { now: seedNow });
    await addTask({
      title: "远期规则",
      recurrence: { freq: "monthly", interval: 1, basis: "due", byMonthday: [10] },
      startAt: "2026-07-10T00:00:00.000Z",
      now: seedNow,
    });

    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));

    expect(buckets.scheduled.map((t) => t.title)).toEqual(["七天内", "八天后", "远期规则"]);
    expect(buckets.scheduledSunkenFromIndex).toBe(1);
  });

  it("scheduled 水位线：全部近期时切点=长度，空桶时=0", async () => {
    const seedNow = new Date("2026-06-14T06:00:00.000Z");
    const empty = await listTasks(new Date("2026-06-14T10:00:00.000Z"));
    expect(empty.scheduledSunkenFromIndex).toBe(0);

    const soon = await addTask({ title: "明天", toInbox: true, now: seedNow });
    await scheduleTask(soon.id, "2026-06-15", { now: seedNow });
    const buckets = await listTasks(new Date("2026-06-14T10:00:00.000Z"));
    expect(buckets.scheduledSunkenFromIndex).toBe(1);
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
    expect(logs.every((log) => log.op === undefined)).toBe(true);
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
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "tasks",
          action: "update",
          op: { type: "skip", at: "2026-06-14T09:00:00.000Z" },
        }),
      ]),
    );
  });
  it("跳过 pending occurrence 后立即物化下一发", async () => {
    const rule = await addTask({
      title: "补铁",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 18)),
      now: new Date("2026-06-18T06:00:00.000Z"),
    });
    await runMaterialization(new Date("2026-06-20T08:00:00.000Z"));
    const first = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped);
    expect(first?.scheduledAt).toBe(localDateOf(new Date(2026, 5, 18)));

    await markOccurrenceSkipped(first!.id, { now: new Date("2026-06-20T08:30:00.000Z") });

    const active = (await db.tasks.where("ruleId").equals(rule.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(active).toHaveLength(1);
    expect(active[0]?.scheduledAt).toBe(localDateOf(new Date(2026, 5, 19)));
  });
  it("对非 occurrence（ruleId=null）抛错", async () => {
    const t = await addTask({ title: "普通" });
    await expect(markOccurrenceSkipped(t.id)).rejects.toThrow();
  });
});

describe("pending occurrence 处理后追平", () => {
  it("完成 pending occurrence 后立即物化下一发", async () => {
    const rule = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 18)),
      now: new Date("2026-06-18T06:00:00.000Z"),
    });
    await runMaterialization(new Date("2026-06-20T08:00:00.000Z"));
    const first = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped);
    expect(first?.scheduledAt).toBe(localDateOf(new Date(2026, 5, 18)));

    await toggleTaskDone(first!.id, { now: new Date("2026-06-20T09:00:00.000Z") });

    const active = (await db.tasks.where("ruleId").equals(rule.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(active).toHaveLength(1);
    expect(active[0]?.scheduledAt).toBe(localDateOf(new Date(2026, 5, 19)));
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
  it("到期 rule 物化 pending occurrence 时克隆模板 children", async () => {
    const rule = await addTask({
      title: "带子项的重复",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 14)),
      now: new Date("2026-06-14T06:00:00.000Z"),
    });
    const doneChild = await createChildTask(rule.id, "已完成子项", new Date("2026-06-14T06:30:00.000Z"));
    await setTaskTags(doneChild.id, ["keep"], { now: new Date("2026-06-14T06:40:00.000Z") });
    await toggleTaskDone(doneChild.id, { now: new Date("2026-06-14T07:00:00.000Z") });
    const todoChild = await createChildTask(rule.id, "未完成子项", new Date("2026-06-14T07:30:00.000Z"));
    await db.syncLog.clear();

    await runMaterialization(new Date("2026-06-14T08:00:00.000Z"));

    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped);
    expect(occ).toBeDefined();
    const occurrenceChildren = await db.tasks.where("parentId").equals(occ!.id).sortBy("sortOrder");
    expect(occurrenceChildren.map((child) => [child.id, child.title, child.done, child.completedAt, child.tags])).toEqual([
      [`${occ!.id}:child:${doneChild.id}`, "已完成子项", false, null, ["keep"]],
      [`${occ!.id}:child:${todoChild.id}`, "未完成子项", false, null, []],
    ]);

    const templateChildren = await db.tasks.where("parentId").equals(rule.id).sortBy("sortOrder");
    expect(templateChildren.map((child) => child.id)).toEqual([doneChild.id, todoChild.id]);
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: occ!.id, action: "create" }),
        expect.objectContaining({ recordId: `${occ!.id}:child:${doneChild.id}`, action: "create" }),
        expect.objectContaining({ recordId: `${occ!.id}:child:${todoChild.id}`, action: "create" }),
      ]),
    );
  });
  it("已有活跃 pending 时不重复物化（幂等）", async () => {
    await addTask({ title: "喝水", recurrence: { freq: "daily", interval: 1, basis: "due" }, startAt: localDateOf(new Date(2026, 5, 14)), now: new Date("2026-06-14T06:00:00.000Z") });
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

  it("删掉 occurrence 的镜像子任务后，跨轮物化不再补回", async () => {
    const rule = await addTask({
      title: "每天",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
    });
    await createChildTask(rule.id, "子步骤");
    const now = new Date();
    await runMaterialization(now);
    const occ = (await db.tasks.toArray()).find((t) => t.ruleId === rule.id && t.recurrence === null);
    const child = (await db.tasks.toArray()).find((t) => t.parentId === occ!.id);
    expect(child).toBeDefined();

    await deleteTaskCascade(child!.id);
    await runMaterialization(now);

    expect((await db.tasks.toArray()).filter((t) => t.parentId === occ!.id)).toHaveLength(0);
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

describe("updateTask 重锚删活跃 occurrence", () => {
  it("改 rule 重锚：删该 rule 当前活跃 pending occurrence + 写 delete syncLog；历史 done 保留", async () => {
    const rule = await addTask({ title: "喝水", recurrence: { freq: "daily", interval: 2, basis: "due" }, startAt: localDateOf(new Date(2026, 5, 20)), now: new Date("2026-06-20T08:00:00.000Z") });
    await db.tasks.add({ id: "occ:live", parentId: null, title: "喝水", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: localDateOf(new Date(2026, 5, 24)), completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: rule.id, skipped: false, sortOrder: 1, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" });
    await db.tasks.add({ id: "occ:live:child:c1", parentId: "occ:live", title: "子项", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: null, completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: null, skipped: false, sortOrder: 0, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" });
    await db.tasks.add({ id: "occ:done", parentId: null, title: "喝水", done: true, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: localDateOf(new Date(2026, 5, 22)), completedCount: 0, weight: 0, completedAt: "2026-06-22T00:00:00.000Z", tags: [], ruleId: rule.id, skipped: false, sortOrder: 2, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });
    await updateTask(rule.id, { recurrence: { freq: "daily", interval: 1, basis: "due" }, startAt: localDateOf(new Date(2026, 5, 27)), now: new Date("2026-06-27T08:00:00.000Z") });
    expect(await db.tasks.get("occ:live")).toBeUndefined();
    expect(await db.tasks.get("occ:live:child:c1")).toBeUndefined();
    expect(await db.tasks.get("occ:done")).toBeDefined();
    await expect(db.syncLog.where("recordId").equals("occ:live").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "delete" })]),
    );
    await expect(db.syncLog.where("recordId").equals("occ:live:child:c1").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "delete" })]),
    );
  });
  it("规则未变保存：活跃 pending occurrence 不被删", async () => {
    const recurrence = { freq: "daily", interval: 2, basis: "due" } as const;
    const startAt = localDateOf(new Date(2026, 5, 20));
    const rule = await addTask({ title: "喝水", recurrence, startAt, now: new Date("2026-06-20T08:00:00.000Z") });
    await db.tasks.add({ id: "occ:live2", parentId: null, title: "喝水", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: startAt, completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: rule.id, skipped: false, sortOrder: 1, createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" });
    await updateTask(rule.id, { recurrence: { ...recurrence }, startAt, now: new Date("2026-06-27T08:00:00.000Z") });
    expect(await db.tasks.get("occ:live2")).toBeDefined();
  });
});

describe("applyRecurrenceChoice 清孤儿 occurrence", () => {
  it("none：转普通时同事务清活跃 pending occurrence，历史 skip 保留", async () => {
    const rule = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 20)),
      now: new Date("2026-06-20T08:00:00.000Z"),
    });
    await db.tasks.add({ id: "occ:none-live", parentId: null, title: "喝水", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: localDateOf(new Date(2026, 5, 20)), completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: rule.id, skipped: false, sortOrder: 1, createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" });
    await db.tasks.add({ id: "occ:none-skip", parentId: null, title: "喝水", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: localDateOf(new Date(2026, 5, 19)), completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: rule.id, skipped: true, sortOrder: 2, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z" });

    const next = await applyRecurrenceChoice(rule.id, { kind: "none" }, { now: new Date("2026-06-21T08:00:00.000Z") });

    expect(next.recurrence).toBeNull();
    expect(await db.tasks.get("occ:none-live")).toBeUndefined();
    expect(await db.tasks.get("occ:none-skip")).toBeDefined();
    await expect(db.syncLog.where("recordId").equals("occ:none-live").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "delete" })]),
    );
  });
  it("scheduled：转一次性日期时同事务清活跃 pending occurrence", async () => {
    const rule = await addTask({
      title: "喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 20)),
      now: new Date("2026-06-20T08:00:00.000Z"),
    });
    await db.tasks.add({ id: "occ:scheduled-live", parentId: null, title: "喝水", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: localDateOf(new Date(2026, 5, 20)), completedCount: 0, weight: 0, completedAt: null, tags: [], ruleId: rule.id, skipped: false, sortOrder: 1, createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" });

    const next = await applyRecurrenceChoice(rule.id, { kind: "scheduled", date: "2026-06-30" }, { now: new Date("2026-06-21T08:00:00.000Z") });

    expect(next).toMatchObject({ recurrence: null, scheduledAt: localDateOf(new Date(2026, 5, 30)) });
    expect(await db.tasks.get("occ:scheduled-live")).toBeUndefined();
    await expect(db.syncLog.where("recordId").equals("occ:scheduled-live").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "delete" })]),
    );
  });
});

describe("deleteTaskCascade 规则级联", () => {
  const day1 = new Date("2026-07-03T08:00:00.000Z");
  const day2 = new Date("2026-07-04T08:00:00.000Z");

  it("删规则：连清 active occurrence 及其子任务，done 历史发保留（#3）", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await createChildTask(rule.id, "补铁", day1);
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 }); // A 变 done 历史发
    await runMaterialization(day2); // 物化 active B
    const occB = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    expect(occB.id).not.toBe(occA.id);

    await deleteTaskCascade(rule.id);

    await expect(db.tasks.get(rule.id)).resolves.toBeUndefined();
    await expect(db.tasks.get(occB.id)).resolves.toBeUndefined(); // active 清掉
    await expect(db.tasks.where("parentId").equals(occB.id).count()).resolves.toBe(0); // 其子任务清掉
    await expect(db.tasks.get(occA.id)).resolves.toBeDefined(); // done 历史发留
    const log = await db.syncLog.where("recordId").equals(occB.id).toArray();
    expect(log.some((l) => l.action === "delete")).toBe(true);
  });

  it("删规则清旧发打 occurrence 死因标记", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await createChildTask(rule.id, "补铁", day1);
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    const occAChild = await db.tasks.where("parentId").equals(occA.id).first();
    await db.syncLog.clear();

    await deleteTaskCascade(rule.id);

    const logs = await db.syncLog.filter((l) => l.action === "delete").toArray();
    expect(logs.find((l) => l.recordId === occA.id)?.deleteReason).toBe("occurrence");
    expect(logs.find((l) => l.recordId === occAChild?.id)?.deleteReason).toBe("occurrence");
    expect(logs.find((l) => l.recordId === rule.id)?.deleteReason).toBe("user");
  });

  it("删模板子任务：连清 active 发里的镜像子任务，done 发的镜像不动（#6）", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    const c1 = await createChildTask(rule.id, "补铁", day1);
    const c2 = await createChildTask(rule.id, "拉伸", day1);
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 });
    await runMaterialization(day2);
    const occB = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await db.syncLog.clear();

    await deleteTaskCascade(c1.id);

    await expect(db.tasks.get(c1.id)).resolves.toBeUndefined();
    await expect(db.tasks.get(`${occB.id}:child:${c1.id}`)).resolves.toBeUndefined(); // active 镜像清掉
    await expect(db.tasks.get(`${occB.id}:child:${c2.id}`)).resolves.toBeDefined(); // 兄弟镜像不动
    await expect(db.tasks.get(`${occA.id}:child:${c1.id}`)).resolves.toBeDefined(); // done 发镜像留
    const logs = await db.syncLog.filter((l) => l.action === "delete").toArray();
    expect(logs.find((l) => l.recordId === `${occB.id}:child:${c1.id}`)?.deleteReason).toBe("mirror");
  });

  it("普通任务/普通子任务的级联删除行为不变", async () => {
    const parent = await addTask({ title: "普通父", now: day1 });
    const child = await createChildTask(parent.id, "普通子", day1);
    await deleteTaskCascade(parent.id);
    await expect(db.tasks.get(parent.id)).resolves.toBeUndefined();
    await expect(db.tasks.get(child.id)).resolves.toBeUndefined();
  });
});

describe("toggleTaskDone 撤勾 occurrence 守卫（#5）", () => {
  const day1 = new Date("2026-07-03T08:00:00.000Z");
  const day2 = new Date("2026-07-04T08:00:00.000Z");

  it("撤勾 done 发时删掉后来物化的 active 发，避免双 active", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await createChildTask(rule.id, "补铁", day1);
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 });
    await runMaterialization(day2);
    const occB = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;

    const reopened = await toggleTaskDone(occA.id, { now: day2 });

    expect(reopened).toMatchObject({ id: occA.id, done: false, completedAt: null });
    await expect(db.tasks.get(occB.id)).resolves.toBeUndefined(); // 后来那发删掉
    await expect(db.tasks.where("parentId").equals(occB.id).count()).resolves.toBe(0);
    const actives = (await db.tasks.where("ruleId").equals(rule.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(actives.map((o) => o.id)).toEqual([occA.id]); // 唯一 active
    const log = await db.syncLog.where("recordId").equals(occB.id).toArray();
    expect(log.some((l) => l.action === "delete")).toBe(true);
  });

  it("撤勾时无其他 active（当天撤勾）：只翻回未完成，不多删", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 }); // done；下一发在明天，无新 active

    const reopened = await toggleTaskDone(occA.id, { now: day1 });

    expect(reopened).toMatchObject({ id: occA.id, done: false });
    await expect(db.tasks.where("ruleId").equals(rule.id).count()).resolves.toBe(1);
  });

  it("普通任务 reopen 行为不变", async () => {
    const t = await addTask({ title: "普通任务", now: day1 });
    await toggleTaskDone(t.id, { now: day1 });
    const reopened = await toggleTaskDone(t.id, { now: day1 });
    expect(reopened).toMatchObject({ id: t.id, done: false, completedAt: null });
  });
});

describe("listTasks 读口径切账本（§9.1）", () => {
  const day1 = new Date("2026-07-03T08:00:00.000Z");

  it("count 型规则做满（账本耗尽）后进 completed，不再僵在 scheduled", async () => {
    const rule = await addTask({
      title: "只此一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: day1,
    });
    await runMaterialization(day1);
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occ.id, { now: day1 });

    const buckets = await listTasks(day1);

    expect(buckets.scheduled.map((t) => t.id)).not.toContain(rule.id);
    expect(buckets.completed.map((t) => t.id)).toContain(rule.id);
  });

  it("scheduled 排序按账本推进的下一到期日，而非模板死游标", async () => {
    // ruleA 先建（sortOrder 靠前），今天那发已完成 → 账本口径下一到期=明天
    const ruleA = await addTask({ title: "A每日", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    const ruleB = await addTask({ title: "B每日", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(ruleA.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 });

    const buckets = await listTasks(day1);
    const order = buckets.scheduled.filter((t) => t.recurrence).map((t) => t.id);

    // 死游标口径两条 key 相同（都是首个应发生日）会保持插入序 [A,B]；账本口径 A 推到明天 → B 在前
    expect(order).toEqual([ruleB.id, ruleA.id]);
  });
});

describe("updateTask 重锚清配额（#4 方案 b）", () => {
  it("count 满耗尽的规则，改规则重锚后配额重置、立即物化新一发", async () => {
    const day1 = new Date("2026-07-03T08:00:00.000Z");
    const day3 = new Date("2026-07-05T08:00:00.000Z");
    const rule = await addTask({
      title: "只此一次",
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 },
      now: day1,
    });
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 });
    expect((await listTasks(day1)).completed.map((t) => t.id)).toContain(rule.id); // 耗尽

    // 改规则（不显式给 startAt）→ 锚推到当下，旧发不再吃配额
    await updateTask(rule.id, { recurrence: { freq: "daily", interval: 1, basis: "due", count: 2 }, now: day3 });

    const buckets = await listTasks(day3);
    expect(buckets.scheduled.map((t) => t.id)).toContain(rule.id); // 回到循环
    const actives = (await db.tasks.where("ruleId").equals(rule.id).toArray()).filter((o) => !o.done && !o.skipped);
    expect(actives).toHaveLength(1); // 重锚即时物化了新一发
    await expect(db.tasks.get(occA.id)).resolves.toBeDefined(); // 历史发保留
  });
});

describe("listTasks atHand 投影", () => {
  it("活跃场任务进 atHand 且未完的不再进原桶", async () => {
    const t = await addTask({ title: "抓我", toInbox: true });
    await grabTaskToHand(t.id, { now: new Date("2026-07-24T01:00:00.000Z") });
    const buckets = await listTasks(new Date("2026-07-24T02:00:00.000Z"));
    expect(buckets.atHand.map((x) => x.id)).toEqual([t.id]);
    expect(buckets.inbox.map((x) => x.id)).not.toContain(t.id);
    expect(buckets.handSession).not.toBeNull();
  });
  it("本场 done 任务同时出现在 atHand 与 completed", async () => {
    const t = await addTask({ title: "抓完", toInbox: true });
    await grabTaskToHand(t.id);
    await toggleTaskDone(t.id);
    const buckets = await listTasks();
    expect(buckets.atHand.map((x) => x.id)).toContain(t.id);
    expect(buckets.completed.map((x) => x.id)).toContain(t.id);
  });
  it("散场后任务自然回原桶", async () => {
    const t = await addTask({ title: "回家", toInbox: true });
    await grabTaskToHand(t.id);
    await endActiveSession();
    const buckets = await listTasks();
    expect(buckets.atHand).toEqual([]);
    expect(buckets.handSession).toBeNull();
    expect(buckets.inbox.map((x) => x.id)).toContain(t.id);
  });
  it("指向已散场的 sessionId 不影响分桶（历史归属）", async () => {
    const t = await addTask({ title: "历史", scheduledAt: "2026-08-01T00:00:00.000Z" });
    await grabTaskToHand(t.id);
    await endActiveSession();
    const buckets = await listTasks(new Date("2026-07-24T02:00:00.000Z"));
    expect(buckets.scheduled.map((x) => x.id)).toContain(t.id);
  });
  it("手头 occurrence 完成后物化的下一发不继承 sessionId", async () => {
    const now = new Date("2026-07-24T07:00:00.000Z"); // 2026-07-24 是周五
    await addTask({
      title: "每周五一发",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], basis: "due", time: "06:00" },
      startAt: "2026-07-24T00:00:00.000Z",
      now,
    });
    await runMaterialization(now);
    const occ = (await db.tasks.toArray()).find((t) => t.ruleId !== null && !t.done && !t.skipped);
    expect(occ).toBeDefined();

    await grabTaskToHand(occ!.id, { now });
    await toggleTaskDone(occ!.id, { now });
    // 完成当发时下一发（下周五）尚未到期，materializeDue 逾期追平闸门不即时物化；
    // 显式推进到下一到期日再跑一次账本物化，逼出下一发校验 sessionId 不继承（不改分桶/物化引擎语义）。
    await runMaterialization(new Date("2026-07-31T07:00:00.000Z"));

    const rows = await db.tasks.toArray();
    const doneOcc = rows.find((t) => t.id === occ!.id);
    const nextOcc = rows.find((t) => t.ruleId !== null && !t.done && !t.skipped && t.id !== occ!.id);
    expect(doneOcc?.sessionId).not.toBeNull(); // 战果保留归属
    expect(nextOcc).toBeDefined(); // 下一到期日物化出新一发
    expect(nextOcc!.sessionId).toBeNull(); // 下一发不继承
  });
});

describe("listTasks projects 桶", () => {
  async function seedGoal(patch: {
    id: string;
    title?: string;
    kind?: "project" | "theme";
    status?: "active" | "archived";
    members: Array<{ kind: "task" | "track"; id: string }>;
    createdAt?: string;
    updatedAt?: string;
  }): Promise<void> {
    await db.goals.add({
      id: patch.id,
      title: patch.title ?? `目标 ${patch.id}`,
      kind: patch.kind ?? "project",
      status: patch.status ?? "active",
      members: patch.members,
      prerequisites: [],
      createdAt: patch.createdAt ?? "2026-07-01T00:00:00.000Z",
      updatedAt: patch.updatedAt ?? "2026-07-01T00:00:00.000Z",
    });
  }

  it("active project 的成员进 projects 桶并带组名", async () => {
    const t = await addTask({ title: "刷墙", toInbox: true });
    await seedGoal({ id: "g1", title: "装修", members: [{ kind: "task", id: t.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects).toHaveLength(1);
    expect(buckets.projects[0]?.goalTitle).toBe("装修");
    expect(buckets.projects[0]?.tasks.map((x) => x.id)).toEqual([t.id]);
  });

  it("归属轴排他：active project 成员离开 inbox，只出现在 projects 桶", async () => {
    const member = await addTask({ title: "刷墙", toInbox: true });
    const free = await addTask({ title: "自由任务", toInbox: true });
    await seedGoal({ id: "g1", members: [{ kind: "task", id: member.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.inbox.map((x) => x.id)).not.toContain(member.id);
    expect(buckets.inbox.map((x) => x.id)).toContain(free.id);
    expect(buckets.projects[0]?.tasks.map((x) => x.id)).toEqual([member.id]);
  });

  it("只属于 theme 目标的任务仍留在 inbox（排他只认 kind==='project'）", async () => {
    const t = await addTask({ title: "主题任务", toInbox: true });
    await seedGoal({ id: "g1", kind: "theme", members: [{ kind: "task", id: t.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.inbox.map((x) => x.id)).toContain(t.id);
    expect(buckets.goalLinkedIds.has(t.id)).toBe(true);
    expect(buckets.projects).toEqual([]);
  });

  it("被写进 members 的 occurrence 不进项目区，也不因此被踢出 inbox（否则整条消失）", async () => {
    const rule = await addTask({
      title: "每天喝水",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      now: new Date("2026-07-09T08:00:00.000Z"),
    });
    await runMaterialization(new Date("2026-07-10T10:00:00.000Z"));
    const occurrence = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((t) => !t.done && !t.skipped);
    expect(occurrence).toBeDefined();
    await seedGoal({ id: "g1", members: [{ kind: "task", id: occurrence?.id ?? "" }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects).toEqual([]);
    // occurrence 落 today 而非 inbox；关键断言是它没被排他吞掉——四个活跃桶里必须找得到它。
    const visible = [...buckets.today, ...buckets.inbox, ...buckets.scheduled, ...buckets.completed];
    expect(visible.map((x) => x.id)).toContain(occurrence?.id);
  });

  it("排他判据与归集判据同源：无排期的僵尸发被写进 members 后仍留在 inbox", async () => {
    // 红线 2 的真闸。上一条用例里的正常 occurrence 恒带 scheduledAt，placement 只会给它
    // today/upcoming，走不到 inbox 分支，因此判别不出排他被写歪。这里直接落一条
    // scheduledAt===null 的「僵尸发」（UI 造不出、数据层可达：addTask/scheduleTask 拒绝的是 UI 路径），
    // 它的 placement 必是 inbox，于是排他分支必被执行：
    // 把排他改成单独判 projectIndex.has(t.id)，它会既进不了项目区（归集守卫要求 ruleId===null）
    // 又被踢出 inbox，整条从页面上消失——本例即刻转红。
    const zombie = {
      id: "occ-僵尸发",
      parentId: null,
      title: "没有排期的一发",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "rule-1",
      sessionId: null,
      skipped: false,
      sortOrder: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    await db.tasks.add(zombie);
    await seedGoal({ id: "g1", members: [{ kind: "task", id: zombie.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.inbox.map((x) => x.id)).toContain(zombie.id);
    expect(buckets.projects).toEqual([]);
  });

  it("theme 目标与 archived 目标都不进 projects 桶", async () => {
    const a = await addTask({ title: "主题任务", toInbox: true });
    const b = await addTask({ title: "归档任务", toInbox: true });
    await seedGoal({ id: "g1", kind: "theme", members: [{ kind: "task", id: a.id }] });
    await seedGoal({ id: "g2", status: "archived", members: [{ kind: "task", id: b.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects).toEqual([]);
  });

  it("被抓到手头的成员仍出现在 projects 桶（焦点轴与归属轴正交）", async () => {
    const t = await addTask({ title: "刷墙", toInbox: true });
    await seedGoal({ id: "g1", members: [{ kind: "task", id: t.id }] });
    await grabTaskToHand(t.id);

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.atHand.map((x) => x.id)).toEqual([t.id]);
    expect(buckets.projects[0]?.tasks.map((x) => x.id)).toEqual([t.id]);
  });

  it("已完成成员只计数，且悬空 ref 不进计数", async () => {
    const open = await addTask({ title: "未完", toInbox: true });
    const done = await addTask({ title: "已完", toInbox: true });
    await toggleTaskDone(done.id);
    await seedGoal({
      id: "g1",
      members: [
        { kind: "task", id: open.id },
        { kind: "task", id: done.id },
        { kind: "task", id: "已被删除的任务" },
      ],
    });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects[0]?.tasks.map((x) => x.id)).toEqual([open.id]);
    expect(buckets.projects[0]?.doneCount).toBe(1);
  });

  it("组内成员排好序才进桶：已排期沉到躺着之后（接线验证）", async () => {
    const future = await addTask({ title: "排到下月", scheduledAt: "2026-08-10T00:00:00.000Z" });
    const idle = await addTask({ title: "躺着", toInbox: true });
    await seedGoal({ id: "g1", members: [{ kind: "task", id: future.id }, { kind: "task", id: idle.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects[0]?.tasks.map((x) => x.title)).toEqual(["躺着", "排到下月"]);
  });

  it("goalLinkedIds 收全 kind（project + theme），不受 projects 口径影响", async () => {
    const a = await addTask({ title: "项目任务", toInbox: true });
    const b = await addTask({ title: "主题任务", toInbox: true });
    await seedGoal({ id: "g1", kind: "project", members: [{ kind: "task", id: a.id }] });
    await seedGoal({ id: "g2", kind: "theme", members: [{ kind: "task", id: b.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect([...buckets.goalLinkedIds].sort()).toEqual([a.id, b.id].sort());
  });

  it("子任务进 projects 桶（即便被写进了 members）", async () => {
    const root = await addTask({ title: "根任务", toInbox: true });
    const child = await createChildTask(root.id, "子步骤");
    await seedGoal({ id: "g1", members: [{ kind: "task", id: child.id }] });

    const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
    expect(buckets.projects.flatMap((g) => g.tasks).map((t) => t.id)).toContain(child.id);
  });

  it("组计数含子任务：收纳不造假进度", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const a = await addTask({ title: "A" });
    const b = await addTask({ title: "B" });
    await addGoalMember(p1.id, { kind: "task", id: a.id });
    await addGoalMember(p1.id, { kind: "task", id: b.id });
    await createChildTask(a.id, "A-1");
    await createChildTask(a.id, "A-2");

    const buckets = await listTasks();
    const group = buckets.projects.find((g) => g.goalId === p1.id);
    expect(group?.tasks).toHaveLength(2);
    expect(group?.pendingChildByMember.get(a.id)).toBe(2);
  });

  /**
   * projectTints 的三条契约（ADR 0026 决策三）。它们无法由组件层的闸覆盖——
   * 组件只拿到「显示出来的组」，而这里守的正是「分配基于全集、与显示无关」。
   */
  describe("projectTints", () => {
    it("覆盖全部 active project，包含没有可解析成员因而不进 projects 桶的那些", async () => {
      const t = await addTask({ title: "刷墙", toInbox: true });
      await seedGoal({ id: "g1", members: [{ kind: "task", id: t.id }] });
      // 成员全是悬空 ref：这个组不会出现在 projects 桶里，但它仍占一个色位。
      await seedGoal({ id: "g2", members: [{ kind: "task", id: "不存在的任务" }] });

      const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
      expect(buckets.projects.map((g) => g.goalId)).toEqual(["g1"]);
      // 若实现改成按 buckets.projects 算，g2 拿不到色、且 g1 的分配会随显示集合漂移。
      expect(buckets.projectTints.has("g2")).toBe(true);
      expect(buckets.projectTints.get("g1")).toBeDefined();
      expect(buckets.projectTints.get("g1")).not.toBe(buckets.projectTints.get("g2"));
    });

    it("归档目标与 theme 目标不占色位", async () => {
      const t = await addTask({ title: "刷墙", toInbox: true });
      await seedGoal({ id: "g1", members: [{ kind: "task", id: t.id }] });
      await seedGoal({ id: "archived", status: "archived", members: [] });
      await seedGoal({ id: "themed", kind: "theme", members: [] });

      const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
      expect([...buckets.projectTints.keys()]).toEqual(["g1"]);
    });

    /**
     * `g1` 与 `g12` 的哈希首选位相同（都是 tint-1），所以「谁拿到首选」直接暴露排序键。
     * 这里让 `g12` 的 createdAt 更早：它应当拿到 tint-1，`g1` 顺移到 tint-2。
     * 若实现改用 id 字典序（或 db 返回顺序），`g1` 会拿到 tint-1，两条断言都红。
     */
    it("按 createdAt 排序分配，不按 id 字典序", async () => {
      await seedGoal({ id: "g1", members: [], createdAt: "2026-07-05T00:00:00.000Z" });
      await seedGoal({ id: "g12", members: [], createdAt: "2026-07-01T00:00:00.000Z" });

      const buckets = await listTasks(new Date("2026-07-10T10:00:00.000Z"));
      expect(buckets.projectTints.get("g12")).toBe("var(--color-tint-1)");
      expect(buckets.projectTints.get("g1")).toBe("var(--color-tint-2)");
    });
  });
});

describe("moveTaskToParent 清手头场指针", () => {
  it("降级为子任务时 sessionId 置空", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await addTask({ title: "被收纳的活" });
    await grabTaskToHand(child.id);
    expect((await db.tasks.get(child.id))?.sessionId).not.toBeNull();

    await moveTaskToParent(child.id, parent.id);

    const after = await db.tasks.get(child.id);
    expect(after?.parentId).toBe(parent.id);
    expect(after?.sessionId ?? null).toBeNull();
  });
});

describe("atHandPendingTotal", () => {
  it("含子任务：3 条压成 1 父 2 子后仍为 3", async () => {
    const a = await addTask({ title: "A" });
    const b = await addTask({ title: "B" });
    const c = await addTask({ title: "C" });
    await grabTaskToHand(a.id);
    await grabTaskToHand(b.id);
    await grabTaskToHand(c.id);
    expect((await listTasks()).atHandPendingTotal).toBe(3);

    await moveTaskToParent(b.id, a.id);
    await moveTaskToParent(c.id, a.id);

    expect((await listTasks()).atHandPendingTotal).toBe(3);
  });

  it("子任务勾完不再计入", async () => {
    const a = await addTask({ title: "A" });
    const b = await addTask({ title: "B" });
    await grabTaskToHand(a.id);
    await grabTaskToHand(b.id);
    await moveTaskToParent(b.id, a.id);
    expect((await listTasks()).atHandPendingTotal).toBe(2);

    await toggleTaskDone(b.id);

    expect((await listTasks()).atHandPendingTotal).toBe(1);
  });

  it("无活跃场时为 0", async () => {
    await addTask({ title: "游离任务" });
    expect((await listTasks()).atHandPendingTotal).toBe(0);
  });

  it("只数手头未完根任务名下的子任务，不含手头外根任务的子任务", async () => {
    // R1 在手头、带 1 条未完子任务；R2 不在手头、也带 1 条未完子任务——
    // 过滤条件 pendingRootIds.has(t.parentId) 被删掉时两条子任务都会被计入，本例会漏抓。
    const r1 = await addTask({ title: "R1" });
    const r1Child = await addTask({ title: "R1 子任务" });
    const r2 = await addTask({ title: "R2" });
    const r2Child = await addTask({ title: "R2 子任务" });
    await grabTaskToHand(r1.id);
    await moveTaskToParent(r1Child.id, r1.id);
    await moveTaskToParent(r2Child.id, r2.id);

    // R1（1）+ r1Child（1）= 2；r2/r2Child 都不在手头，不应计入。
    expect((await listTasks()).atHandPendingTotal).toBe(2);
  });
});

describe("删除任务连带清关系边", () => {
  it("deleteTask 删掉任务作为 blocker 的边", async () => {
    const blocker = await addTask({ title: "挡路" });
    const blocked = await addTask({ title: "被挡" });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });

    await deleteTask(blocker.id);

    expect(await db.taskRelations.count()).toBe(0);
  });

  it("deleteTask 删掉任务作为 blocked 的边", async () => {
    const blocker = await addTask({ title: "挡路" });
    const blocked = await addTask({ title: "被挡" });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });

    await deleteTask(blocked.id);

    expect(await db.taskRelations.count()).toBe(0);
  });

  it("删除无关任务不影响别人的边", async () => {
    const a = await addTask({ title: "A" });
    const b = await addTask({ title: "B" });
    const c = await addTask({ title: "C" });
    const d = await addTask({ title: "D" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    await addTaskRelation({ blocker: { kind: "task", id: c.id }, blocked: { kind: "task", id: d.id } });

    await deleteTask(c.id);

    expect(await db.taskRelations.count()).toBe(1);
    const remaining = await db.taskRelations.toArray();
    expect(remaining[0]).toMatchObject({ blockerId: a.id, blockedId: b.id });
  });

  it("deleteTaskCascade 删父任务时子任务参与的边也被清除", async () => {
    const parent = await addTask({ title: "父" });
    const child = await createChildTask(parent.id, "子");
    const other = await addTask({ title: "别的任务" });
    await addTaskRelation({ blocker: { kind: "task", id: parent.id }, blocked: { kind: "task", id: other.id } });
    await addTaskRelation({ blocker: { kind: "task", id: child.id }, blocked: { kind: "task", id: other.id } });

    await deleteTaskCascade(parent.id);

    expect(await db.taskRelations.count()).toBe(0);
  });
});

describe("删模板子任务时镜像子任务的关系边被清除", () => {
  const day1 = new Date("2026-07-03T08:00:00.000Z");

  it("删模板子任务：active 发里镜像子任务参与的关系边也被清除", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    const c1 = await createChildTask(rule.id, "补铁", day1);
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    const mirrorId = occurrenceChildId(occA.id, c1.id);
    const other = await addTask({ title: "别的任务" });
    await addTaskRelation({ blocker: { kind: "task", id: mirrorId }, blocked: { kind: "task", id: other.id } });

    await deleteTaskCascade(c1.id);

    await expect(db.tasks.get(mirrorId)).resolves.toBeUndefined();
    expect(await db.taskRelations.count()).toBe(0);
  });
});

describe("删除 occurrence 时其关系边被清除", () => {
  const day1 = new Date("2026-07-03T08:00:00.000Z");
  const day2 = new Date("2026-07-04T08:00:00.000Z");

  it("撤勾 done 发删掉后来物化的 active 发时，该发参与的关系边也被清除", async () => {
    const rule = await addTask({ title: "晨间例行", recurrence: { freq: "daily", interval: 1, basis: "due" }, now: day1 });
    await runMaterialization(day1);
    const occA = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    await toggleTaskDone(occA.id, { now: day1 });
    await runMaterialization(day2);
    const occB = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    const other = await addTask({ title: "别的任务" });
    await addTaskRelation({ blocker: { kind: "task", id: occB.id }, blocked: { kind: "task", id: other.id } });

    await toggleTaskDone(occA.id, { now: day2 });

    await expect(db.tasks.get(occB.id)).resolves.toBeUndefined();
    expect(await db.taskRelations.count()).toBe(0);
  });
});

describe("子任务分区口径（阶段3）", () => {
  const NOW = new Date("2026-07-08T10:00:00.000Z");

  it("有排期的子任务进 today", async () => {
    const parent = await addTask({ title: "装修" });
    const child = await createChildTask(parent.id, "找工人");
    await scheduleTask(child.id, "2026-07-08", { now: NOW });

    const buckets = await listTasks(NOW);
    expect(buckets.today.map((t) => t.id)).toContain(child.id);
  });

  it("排在将来的子任务进 scheduled", async () => {
    const parent = await addTask({ title: "装修" });
    const child = await createChildTask(parent.id, "找工人");
    await scheduleTask(child.id, "2026-07-11", { now: NOW });

    const buckets = await listTasks(NOW);
    expect(buckets.scheduled.map((t) => t.id)).toContain(child.id);
  });

  it("被抓进手头的子任务进 atHand", async () => {
    const parent = await addTask({ title: "装修" });
    const child = await createChildTask(parent.id, "找工人");
    await grabTaskToHand(child.id);

    const buckets = await listTasks(NOW);
    expect(buckets.atHand.map((t) => t.id)).toContain(child.id);
  });

  it("没排期的子任务不进 inbox", async () => {
    const parent = await addTask({ title: "装修" });
    const child = await createChildTask(parent.id, "找工人");

    const buckets = await listTasks(NOW);
    expect(buckets.inbox.map((t) => t.id)).not.toContain(child.id);
  });

  it("已完成的子任务不进 today，走 completed", async () => {
    const parent = await addTask({ title: "装修" });
    const child = await createChildTask(parent.id, "找工人");
    await scheduleTask(child.id, "2026-07-08", { now: NOW });
    await toggleTaskDone(child.id, { now: NOW });

    const buckets = await listTasks(NOW);
    expect(buckets.today.map((t) => t.id)).not.toContain(child.id);
    expect(buckets.completed.map((t) => t.id)).toContain(child.id);
  });

  it("重复模板的子任务仍不独立进桶", async () => {
    const rule = await addTask({
      title: "每周三倒垃圾",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [3], basis: "due" },
      startAt: localDateOf(new Date(2026, 6, 8)),
    });
    const child = await createChildTask(rule.id, "换垃圾袋");

    const buckets = await listTasks(NOW);
    expect(buckets.today.map((t) => t.id)).not.toContain(child.id);
    expect(buckets.inbox.map((t) => t.id)).not.toContain(child.id);
    expect(buckets.scheduled.map((t) => t.id)).not.toContain(child.id);
  });
});

describe("在等桶：被未完成前置挡住的任务（界面分流）", () => {
  const NOW = new Date("2026-07-10T10:00:00.000Z");

  it("被未完成前置挡住的任务进 waiting 桶，且不在 today/inbox/scheduled 里", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });

    const buckets = await listTasks(NOW);
    expect(buckets.waiting.map((t) => t.id)).toContain(blocked.id);
    expect(buckets.waiting.map((t) => t.id)).not.toContain(blocker.id);
    expect(buckets.today.map((t) => t.id)).not.toContain(blocked.id);
    expect(buckets.inbox.map((t) => t.id)).not.toContain(blocked.id);
    expect(buckets.scheduled.map((t) => t.id)).not.toContain(blocked.id);
  });

  it("前置完成后自动解锁：被挡任务回到它本来该在的区", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    expect((await listTasks(NOW)).waiting.map((t) => t.id)).toContain(blocked.id);

    await toggleTaskDone(blocker.id, { now: NOW });

    const buckets = await listTasks(NOW);
    expect(buckets.waiting.map((t) => t.id)).not.toContain(blocked.id);
    expect(buckets.inbox.map((t) => t.id)).toContain(blocked.id);
  });

  it("被挡但已在手头的任务留在 atHand，不进 waiting", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    await grabTaskToHand(blocked.id);

    const buckets = await listTasks(NOW);
    expect(buckets.atHand.map((t) => t.id)).toContain(blocked.id);
    expect(buckets.waiting.map((t) => t.id)).not.toContain(blocked.id);
  });

  it("被挡但已完成的任务留在 completed，不进 waiting", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    await toggleTaskDone(blocked.id, { now: NOW });

    const buckets = await listTasks(NOW);
    expect(buckets.completed.map((t) => t.id)).toContain(blocked.id);
    expect(buckets.waiting.map((t) => t.id)).not.toContain(blocked.id);
  });

  it("被挡的项目成员仍出现在项目区（归属轴与状态轴正交）", async () => {
    const member = await addTask({ title: "刷墙", toInbox: true });
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: member.id } });
    const goal = await addGoal({ title: "装修", kind: "project" });
    await addGoalMember(goal.id, { kind: "task", id: member.id });

    const buckets = await listTasks(NOW);
    expect(buckets.waiting.map((t) => t.id)).toContain(member.id);
    expect(buckets.projects[0]?.tasks.map((t) => t.id)).toEqual([member.id]);
  });

  it("waitingBlockerTitles 给出 blocker 的标题", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });

    const buckets = await listTasks(NOW);
    expect(buckets.waitingBlockerTitles[blocked.id]).toEqual(["挡路的前置"]);
  });

  it("waitingBlockerTitles 对悬空任务前置显示已删除占位", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    await db.tasks.delete(blocker.id);

    const buckets = await listTasks(NOW);
    expect(buckets.waitingBlockerTitles[blocked.id]).toEqual(["（已删除）"]);
  });

  it("被挡的项目成员带进组级 blockedMemberIds（徽章数据源）", async () => {
    const member = await addTask({ title: "刷墙", toInbox: true });
    const free = await addTask({ title: "自由成员", toInbox: true });
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: member.id } });
    const goal = await addGoal({ title: "装修", kind: "project" });
    await addGoalMember(goal.id, { kind: "task", id: member.id });
    await addGoalMember(goal.id, { kind: "task", id: free.id });

    const buckets = await listTasks(NOW);
    expect(buckets.projects[0]?.blockedMemberIds.has(member.id)).toBe(true);
    expect(buckets.projects[0]?.blockedMemberIds.has(free.id)).toBe(false);
  });

  it("blocker 被删后留下的悬空边不再挡人：被挡任务回到它本来该在的区", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    expect((await listTasks(NOW)).waiting.map((t) => t.id)).toContain(blocked.id);

    // 直接删 tasks 行、不走 deleteTaskCascade——模拟老客户端只推 tasks/delete、关系表留悬空边。
    await db.tasks.delete(blocker.id);

    const buckets = await listTasks(NOW);
    expect(buckets.waiting.map((t) => t.id)).not.toContain(blocked.id);
    expect(buckets.inbox.map((t) => t.id)).toContain(blocked.id);
  });

  it("悬空边本身不被删掉——用户还要能在详情面板里看见并删它", async () => {
    const blocker = await addTask({ title: "挡路的前置", toInbox: true });
    const blocked = await addTask({ title: "被挡的活", toInbox: true });
    await addTaskRelation({ blocker: { kind: "task", id: blocker.id }, blocked: { kind: "task", id: blocked.id } });
    await db.tasks.delete(blocker.id);

    await listTasks(NOW);
    await expect(db.taskRelations.toArray()).resolves.toHaveLength(1);
  });
});
