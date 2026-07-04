import { describe, expect, it } from "vitest";
import { TaskSchema, type Task } from "@timedata/shared";
import { completionOp } from "./completionOp.js";

const AT = "2026-07-04T01:00:00.000Z";

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
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  });
}

describe("completionOp", () => {
  it("done 升 -> complete", () => {
    expect(completionOp(task(), task({ done: true, completedAt: AT }), AT)).toEqual({ type: "complete", at: AT });
  });

  it("done 降 -> reopen", () => {
    expect(completionOp(task({ done: true, completedAt: AT }), task(), AT)).toEqual({ type: "reopen", at: AT });
  });

  it("skipped 升 -> skip", () => {
    expect(completionOp(task(), task({ skipped: true }), AT)).toEqual({ type: "skip", at: AT });
  });

  it("仅 lastDoneAt/completedCount 变化 -> amend", () => {
    expect(completionOp(task({ lastDoneAt: AT, completedCount: 3 }), task(), AT)).toEqual({ type: "amend", at: AT });
  });

  it("完成字段无变化 -> undefined", () => {
    expect(completionOp(task(), task({ title: "改名", sortOrder: 9 }), AT)).toBeUndefined();
  });

  it("prev 缺完成字段默认值时不误报", () => {
    const prev = { ...task(), completedCount: undefined, skipped: undefined } as unknown as Task;
    expect(completionOp(prev, task(), AT)).toBeUndefined();
  });

  it("create 时只对非默认完成态生成 op", () => {
    expect(completionOp(undefined, task({ done: true, completedAt: AT }), AT)).toEqual({ type: "complete", at: AT });
    expect(completionOp(undefined, task({ skipped: true }), AT)).toEqual({ type: "skip", at: AT });
    expect(completionOp(undefined, task(), AT)).toBeUndefined();
  });
});
