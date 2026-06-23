import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import {
  addGoalMember,
  addGoal,
  addTaskForGoal,
  deleteGoal,
  getGoal,
  listGoals,
  removeGoalMember,
  updateGoal,
  updateGoalPrerequisites,
} from "./goals.js";

const now = "2026-06-22T01:00:00.000Z";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

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

    const updated = await updateGoal(goal.id, { title: "发布 v2.1", kind: "theme", note: "长期推进", now: date("2026-06-22T02:00:00.000Z") });
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
      expect.arrayContaining([
        expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "update" }),
      ]),
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
      updateGoalPrerequisites(goal.id, [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "task", id: "task-1" } }]),
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
      expect.arrayContaining([
        expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "delete" }),
      ]),
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
