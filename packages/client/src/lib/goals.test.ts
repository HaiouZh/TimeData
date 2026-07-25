import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  addGoal,
  addGoalMember,
  addTaskForGoal,
  deleteGoal,
  getGoal,
  listGoals,
  removeGoalMember,
  updateGoal,
  updateGoalPrerequisites,
} from "./goals.js";
import { addTask } from "./tasks.js";

const now = "2026-06-22T01:00:00.000Z";

beforeEach(resetDb);

afterEach(resetDb);

function date(iso: string): Date {
  return new Date(iso);
}

async function seedMembers(): Promise<void> {
  await db.tasks.add({
    id: "task-1",
    parentId: null,
    title: "写发布文案",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.tracks.add({
    id: "track-1",
    title: "发布轨道",
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
  });
}

describe("goals data helpers", () => {
  it("creates, lists, reads, and updates goals with sync logs", async () => {
    const goal = await addGoal({ title: " 发布 v2 ", kind: "project", now: date(now) });

    expect(goal).toMatchObject({ title: "发布 v2", kind: "project", status: "active", members: [], prerequisites: [] });
    await expect(getGoal(goal.id)).resolves.toMatchObject({ title: "发布 v2" });
    await expect(listGoals()).resolves.toHaveLength(1);

    const updated = await updateGoal(goal.id, {
      title: "发布 v2.1",
      kind: "theme",
      note: "长期推进",
      now: date("2026-06-22T02:00:00.000Z"),
    });
    expect(updated).toMatchObject({ title: "发布 v2.1", kind: "theme", note: "长期推进" });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "goals", action: "create" }),
        expect.objectContaining({ tableName: "goals", action: "update" }),
      ]),
    );
  });

  it("adds and removes typed members without mutating tasks or tracks", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();

    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:00:00.000Z") });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" }, { now: date("2026-06-22T02:01:00.000Z") });

    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
    });
    await expect(db.tasks.get("task-1")).resolves.not.toHaveProperty("goalId");
    await expect(db.tracks.get("track-1")).resolves.not.toHaveProperty("goalId");

    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:02:00.000Z") });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
    });

    await removeGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T03:00:00.000Z") });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({ members: [{ kind: "track", id: "track-1" }] });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "update" })]),
    );
  });

  it("updates prerequisites and rejects invalid goal edits through shared schema", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" });
    await updateGoalPrerequisites(
      goal.id,
      [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
      { now: date("2026-06-22T02:00:00.000Z") },
    );
    await expect(getGoal(goal.id)).resolves.toMatchObject({
      prerequisites: [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
    });
    await expect(
      updateGoalPrerequisites(goal.id, [
        { blocker: { kind: "task", id: "task-1" }, blocked: { kind: "task", id: "task-1" } },
      ]),
    ).rejects.toThrow();
  });

  it("removing a member also removes related prerequisites", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" });
    await updateGoalPrerequisites(goal.id, [
      { blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } },
    ]);

    await removeGoalMember(goal.id, { kind: "task", id: "task-1" });

    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [{ kind: "track", id: "track-1" }],
      prerequisites: [],
    });
  });

  it("deletes a goal and keeps members untouched", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:00:00.000Z") });

    await deleteGoal(goal.id, { now: date("2026-06-22T03:00:00.000Z") });

    await expect(db.goals.get(goal.id)).resolves.toBeUndefined();
    await expect(db.tasks.get("task-1")).resolves.toBeDefined();
    await expect(db.tracks.get("track-1")).resolves.toBeDefined();
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "delete" })]),
    );
  });

  it("creates a task and appends it to Goal.members atomically", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    const task = await addTaskForGoal(goal.id, {
      title: "写发布文案",
      toInbox: false,
      now: date("2026-06-22T02:00:00.000Z"),
    });

    expect(task).toMatchObject({ title: "写发布文案", done: false, tags: [] });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [{ kind: "task", id: task.id }],
    });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "tasks", recordId: task.id, action: "create" }),
        expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "update" }),
      ]),
    );
  });
});

describe("归属变更同事务刷新成员任务 updatedAt", () => {
  const STALE = "2026-01-01T00:00:00.000Z";

  async function staleTaskInProject(): Promise<{ goalId: string; taskId: string }> {
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "刷墙", toInbox: true });
    await addGoalMember(goal.id, { kind: "task", id: task.id });
    await db.tasks.update(task.id, { updatedAt: STALE });
    return { goalId: goal.id, taskId: task.id };
  }

  it("removeGoalMember 刷新被移出任务的 updatedAt 并记 syncLog", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await removeGoalMember(goalId, { kind: "task", id: taskId });

    const after = await db.tasks.get(taskId);
    expect(after?.updatedAt).not.toBe(STALE);
    const logs = await db.syncLog.filter((e) => e.tableName === "tasks" && e.recordId === taskId).toArray();
    expect(logs.length).toBeGreaterThan(0);
  });

  it("归档目标刷新全部成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { status: "archived" });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("kind 从 project 改成 theme 也刷新成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { kind: "theme" });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("members 整包替换移除成员时刷新（GoalGraphEditor 的撤销路径）", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { members: [] });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("deleteGoal 刷新全部成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await deleteGoal(goalId);
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("只改标题不刷新成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { title: "新名字" });
    expect((await db.tasks.get(taskId))?.updatedAt).toBe(STALE);
  });

  it("重复加同一成员（幂等早退）不刷新任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await db.tasks.update(taskId, { updatedAt: STALE });
    await addGoalMember(goalId, { kind: "task", id: taskId });
    expect((await db.tasks.get(taskId))?.updatedAt).toBe(STALE);
  });

  it("移出本就不在组里的成员（幂等早退）不刷新任务", async () => {
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "无关任务", toInbox: true });
    await db.tasks.update(task.id, { updatedAt: STALE });
    await removeGoalMember(goal.id, { kind: "task", id: task.id });
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });

  it("theme 目标的成员变更不触发 touch（只有 active project 拥有归属）", async () => {
    const goal = await addGoal({ title: "主题", kind: "theme" });
    const task = await addTask({ title: "主题任务", toInbox: true });
    await addGoalMember(goal.id, { kind: "task", id: task.id });
    await db.tasks.update(task.id, { updatedAt: STALE });
    await removeGoalMember(goal.id, { kind: "task", id: task.id });
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });
});
