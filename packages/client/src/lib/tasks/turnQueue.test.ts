import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { selectRunning, selectWaitingOnMe } from "./turnQueue.js";

const mkTask = (id: string, turn: Task["turn"], turnAt: string | null, done = false): Task => ({
  id,
  title: id,
  done,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,  completedCount: 0,
  turn,
  turnAt,
  sortOrder: 0,
  createdAt: "2026-06-16T00:00:00.000Z",
  updatedAt: "2026-06-16T00:00:00.000Z",
});

describe("turnQueue", () => {
  it("selectWaitingOnMe 取 turn=me 未完成任务，按 turnAt 升序", () => {
    const tasks = [
      mkTask("new", "me", "2026-06-16T03:00:00.000Z"),
      mkTask("old", "me", "2026-06-16T01:00:00.000Z"),
      mkTask("running", "running", "2026-06-16T00:00:00.000Z"),
      mkTask("parked", "parked", "2026-06-16T00:00:00.000Z"),
      mkTask("done", "me", "2026-06-16T00:00:00.000Z", true),
    ];

    expect(selectWaitingOnMe(tasks).map((task) => task.id)).toEqual(["old", "new"]);
  });

  it("selectRunning 取 turn=running 未完成任务，按 turnAt 升序", () => {
    const tasks = [
      mkTask("b", "running", "2026-06-16T02:00:00.000Z"),
      mkTask("a", "running", "2026-06-16T01:00:00.000Z"),
      mkTask("me", "me", "2026-06-16T00:00:00.000Z"),
      mkTask("done", "running", "2026-06-16T00:00:00.000Z", true),
    ];

    expect(selectRunning(tasks).map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("不改变输入数组顺序", () => {
    const tasks = [
      mkTask("b", "running", "2026-06-16T02:00:00.000Z"),
      mkTask("a", "running", "2026-06-16T01:00:00.000Z"),
    ];

    selectRunning(tasks);

    expect(tasks.map((task) => task.id)).toEqual(["b", "a"]);
  });
});
