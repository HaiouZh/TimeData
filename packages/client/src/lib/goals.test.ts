import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import {
  addGoal,
  assignTaskToGoal,
  assignTrackToGoal,
  deleteGoal,
  getGoal,
  listGoalTasks,
  listGoalTracks,
  listGoals,
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
    goalId: null,
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
    goalId: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("goals data helpers", () => {
  it("creates, lists, reads, and updates goals with sync logs", async () => {
    const goal = await addGoal({ title: " 发布 v2 ", kind: "project", now: date(now) });

    expect(goal).toMatchObject({ title: "发布 v2", kind: "project", status: "active", prerequisites: [] });
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

  it("assigns tasks/tracks to goals and records member updates", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();

    await assignTaskToGoal("task-1", goal.id, { now: date("2026-06-22T02:00:00.000Z") });
    await assignTrackToGoal("track-1", goal.id, { now: date("2026-06-22T02:00:00.000Z") });

    await expect(listGoalTasks(goal.id)).resolves.toMatchObject([{ id: "task-1", goalId: goal.id }]);
    await expect(listGoalTracks(goal.id)).resolves.toMatchObject([{ id: "track-1", goalId: goal.id }]);
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "tasks", recordId: "task-1", action: "update" }),
        expect.objectContaining({ tableName: "tracks", recordId: "track-1", action: "update" }),
      ]),
    );
  });

  it("updates prerequisites and rejects invalid goal edits through shared schema", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await updateGoalPrerequisites(goal.id, [{ blocker: "task-1", blocked: "track-1" }], { now: date("2026-06-22T02:00:00.000Z") });
    await expect(getGoal(goal.id)).resolves.toMatchObject({
      prerequisites: [{ blocker: "task-1", blocked: "track-1" }],
    });
    await expect(updateGoalPrerequisites(goal.id, [{ blocker: "task-1", blocked: "task-1" }])).rejects.toThrow();
  });

  it("deletes a goal and clears member goalId without deleting members", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await assignTaskToGoal("task-1", goal.id, { now: date("2026-06-22T02:00:00.000Z") });
    await assignTrackToGoal("track-1", goal.id, { now: date("2026-06-22T02:00:00.000Z") });

    await deleteGoal(goal.id, { now: date("2026-06-22T03:00:00.000Z") });

    await expect(db.goals.get(goal.id)).resolves.toBeUndefined();
    await expect(db.tasks.get("task-1")).resolves.toMatchObject({ goalId: null });
    await expect(db.tracks.get("track-1")).resolves.toMatchObject({ goalId: null });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "delete" }),
        expect.objectContaining({ tableName: "tasks", recordId: "task-1", action: "update" }),
        expect.objectContaining({ tableName: "tracks", recordId: "track-1", action: "update" }),
      ]),
    );
  });
});
