import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { selectTasksCompletedOn } from "./diaryRefTasks.js";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    parentId: null, title: `任务 ${over.id}`, done: true, recurrence: null, lastDoneAt: null,
    startAt: null, scheduledAt: null, completedCount: 0, weight: 0, completedAt: null, tags: [],
    ruleId: null, sessionId: null, skipped: false, sortOrder: 0,
    createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
    ...over,
  } as Task;
}

describe("selectTasksCompletedOn", () => {
  it("挑出当天完成的任务", () => {
    const out = selectTasksCompletedOn([task({ id: "a", completedAt: "2026-07-25T02:00:00.000Z" })], "2026-07-25");
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });

  it("done 为 false 的不算（耗尽的重复模板会混进 completed 桶，靠这条挡住）", () => {
    expect(selectTasksCompletedOn([task({ id: "a", done: false, completedAt: "2026-07-25T02:00:00.000Z" })], "2026-07-25")).toEqual([]);
  });

  it("completedAt 为 null 的不算，绝不回退到 updatedAt", () => {
    // 若实现里写了 completedAt ?? updatedAt，本条必红——updatedAt 正是 07-25。
    expect(selectTasksCompletedOn([task({ id: "a", completedAt: null, updatedAt: "2026-07-25T02:00:00.000Z" })], "2026-07-25")).toEqual([]);
  });

  it("按 Asia/Shanghai 日界归日，不是 UTC 日界", () => {
    // UTC 2026-07-24T17:00Z = 本地 2026-07-25 01:00，应算 07-25 而非 07-24
    const rows = [task({ id: "a", completedAt: "2026-07-24T17:00:00.000Z" })];
    expect(selectTasksCompletedOn(rows, "2026-07-25").map((t) => t.id)).toEqual(["a"]);
    expect(selectTasksCompletedOn(rows, "2026-07-24")).toEqual([]);
  });

  it("别的日期完成的不算", () => {
    expect(selectTasksCompletedOn([task({ id: "a", completedAt: "2026-07-20T02:00:00.000Z" })], "2026-07-25")).toEqual([]);
  });

  it("按完成时间升序（先完成的排前面，读起来像一天的流水）", () => {
    const out = selectTasksCompletedOn(
      [task({ id: "b", completedAt: "2026-07-25T09:00:00.000Z" }), task({ id: "a", completedAt: "2026-07-25T02:00:00.000Z" })],
      "2026-07-25",
    );
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
