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
    scheduledAt: null,    completedCount: 0,
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
  it("existing 为空 -> 应用", () => {
    expect(__test.taskNeedsApply(undefined, task())).toBe(true);
  });

  it("schema 投影相等 -> 不应用（本地孤儿不触发）", () => {
    const existing = { ...task(), ghostField: "local-only" } as Task;

    expect(__test.taskNeedsApply(existing, task())).toBe(false);
  });

  it("任一字段差异 -> 应用（无需手列字段）", () => {
    expect(__test.taskNeedsApply(task({ tags: [] }), task({ tags: ["agent"] }))).toBe(true);
  });

  it("任一侧无法解析 -> 保守应用", () => {
    const existing = { ...task(), title: "" } as Task;

    expect(__test.taskNeedsApply(existing, task())).toBe(true);
  });

  it("detects parentId changes", () => {
    const existing = task({ id: "child-1", parentId: "root-a" });
    const remote = task({ id: "child-1", parentId: "root-b" });

    expect(__test.taskNeedsApply(existing, remote)).toBe(true);
  });
});
