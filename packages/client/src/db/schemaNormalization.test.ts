import { describe, expect, it } from "vitest";
import { TaskSchema } from "@timedata/shared";
import { isDeepEqual, planNormalization } from "./schemaNormalization.js";

const keyOf = (doc: Record<string, unknown>) => String(doc.id);
const baseTask = {
  id: "a",
  parentId: null,
  title: "A",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  sortOrder: 0,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};
const normalizedTask = {
  ...baseTask,
  completedCount: 0,
  turn: null,
  turnAt: null,
  completedAt: null,
  tags: [],
};

describe("isDeepEqual", () => {
  it("对象键顺序不同但内容相同 -> 相等", () => {
    expect(isDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("数组顺序敏感", () => {
    expect(isDeepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("多一个键 -> 不等", () => {
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("planNormalization", () => {
  it("缺字段按默认值计划写回", () => {
    const plan = planNormalization([baseTask], TaskSchema, keyOf);

    expect(plan).toEqual({
      writes: [{ key: "a", value: normalizedTask }],
      skipped: [],
    });
  });

  it("孤儿字段被 strip 并计划写回", () => {
    const plan = planNormalization(
      [{ ...normalizedTask, ghostField: true }],
      TaskSchema,
      keyOf,
    );

    expect(plan.writes).toEqual([{ key: "a", value: normalizedTask }]);
    expect(plan.skipped).toEqual([]);
  });

  it("干净数据不写回；键顺序不同也不写回", () => {
    const clean = planNormalization([normalizedTask], TaskSchema, keyOf);
    const reordered = planNormalization([
      {
        title: "A",
        id: "a",
        completedAt: null,
        turnAt: null,
        turn: null,
        completedCount: 0,
        tags: [],
        sortOrder: 0,
        scheduledAt: null,
        startAt: null,
        lastDoneAt: null,
        recurrence: null,
        done: false,
        parentId: null,
        updatedAt: "2026-06-20T00:00:00.000Z",
        createdAt: "2026-06-20T00:00:00.000Z",
      },
    ], TaskSchema, keyOf);

    expect(clean.writes).toEqual([]);
    expect(reordered.writes).toEqual([]);
  });

  it("坏行进 skipped 不进 writes", () => {
    const plan = planNormalization([{ id: "a" }], TaskSchema, keyOf);

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([{ key: "a", issues: expect.arrayContaining([expect.stringContaining("title")]) }]);
  });
});
