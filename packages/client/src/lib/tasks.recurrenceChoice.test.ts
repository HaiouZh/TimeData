import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { addTask, applyRecurrenceChoice, toggleTaskDone } from "./tasks.js";
import { normalizeScheduledDate, placementForTask } from "./tasks/placement.js";

beforeEach(async () => {
  await db.tasks.clear();
  await db.syncLog.clear();
});

describe("applyRecurrenceChoice", () => {
  it("none 清 recurrence 和 completedCount", async () => {
    const task = await addTask({ title: "x", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await toggleTaskDone(task.id);
    await toggleTaskDone(task.id);

    await applyRecurrenceChoice(task.id, { kind: "none" });

    const saved = await db.tasks.get(task.id);
    expect(saved?.recurrence).toBeNull();
    expect(saved?.completedCount).toBe(0);
  });

  it("recurrence 写规则 + startAt", async () => {
    const task = await addTask({ title: "x" });
    const startAt = normalizeScheduledDate("2026-06-16");

    await applyRecurrenceChoice(task.id, {
      kind: "recurrence",
      recurrence: { freq: "daily", interval: 2, basis: "due" },
      startAt,
    });

    const saved = await db.tasks.get(task.id);
    expect(saved?.recurrence).toMatchObject({ freq: "daily", interval: 2 });
    expect(saved?.startAt).toBe(startAt);
  });

  it("scheduled 从重复任务切换：最终态正确且只产生一条 syncLog", async () => {
    const task = await addTask({ title: "x", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await db.syncLog.clear();

    await applyRecurrenceChoice(task.id, { kind: "scheduled", date: "2026-07-01" });

    const saved = await db.tasks.get(task.id);
    expect(saved?.recurrence).toBeNull();
    expect(saved?.startAt).toBeNull();
    expect(saved?.scheduledAt).toBe(normalizeScheduledDate("2026-07-01"));
    expect(await db.syncLog.count()).toBe(1);
  });

  it("scheduled 从已完成过的重复任务切换时清 completedCount", async () => {
    const task = await addTask({ title: "x", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await toggleTaskDone(task.id);
    await toggleTaskDone(task.id);

    await applyRecurrenceChoice(task.id, { kind: "scheduled", date: "2026-07-01" });

    expect((await db.tasks.get(task.id))?.completedCount).toBe(0);
  });

  it("addTask 显式 scheduledAt：一次建普通排期任务，只有 create 日志", async () => {
    const task = await addTask({ title: "x", scheduledAt: normalizeScheduledDate("2026-07-01"), toInbox: true });

    const saved = await db.tasks.get(task.id);
    expect(saved?.recurrence).toBeNull();
    expect(saved?.scheduledAt).toBe(normalizeScheduledDate("2026-07-01"));
    expect(await db.syncLog.count()).toBe(1);
  });

  it("placement：设 startAt 的每 N 天，未到落 recurring（重复区）、到日进 today", async () => {
    const task = await addTask({ title: "x" });

    await applyRecurrenceChoice(task.id, {
      kind: "recurrence",
      recurrence: { freq: "daily", interval: 2, basis: "due" },
      startAt: normalizeScheduledDate("2026-06-20"),
    });

    const saved = await db.tasks.get(task.id);
    expect(placementForTask(saved!, new Date("2026-06-18T12:00:00"))?.pool).toBe("recurring");
    expect(placementForTask(saved!, new Date("2026-06-20T12:00:00"))?.pool).toBe("today");
  });
});
