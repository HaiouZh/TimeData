import { describe, expect, it } from "vitest";
import { TaskSchema, type Task } from "@timedata/shared";
import { __test } from "./clientDomains.js";

function task(overrides: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: "t1",
    parentId: null,
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    subtasks: [],
    completedCount: 0,
    turn: null,
    turnAt: null,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("taskNeedsApply", () => {
  it("detects parentId changes", () => {
    const existing = task({ id: "child-1", parentId: "root-a" });
    const remote = task({ id: "child-1", parentId: "root-b" });

    expect(__test.taskNeedsApply(existing, remote)).toBe(true);
  });
});
