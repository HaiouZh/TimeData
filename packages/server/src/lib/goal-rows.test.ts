import { describe, expect, it } from "vitest";
import { goalToRow, rowToGoal } from "./goal-rows.js";

const now = "2026-06-22T01:00:00.000Z";

describe("goal rows", () => {
  it("maps goals to JSON row columns and back", () => {
    const goal = {
      id: "goal-1",
      title: "发布 v2",
      kind: "project" as const,
      status: "active" as const,
      note: "结果定义",
      prerequisites: [{ blocker: "task-1", blocked: "track-1" }],
      createdAt: now,
      updatedAt: "2026-06-22T02:00:00.000Z",
    };

    const row = goalToRow(goal);

    expect(row).toMatchObject({
      id: "goal-1",
      prerequisites: JSON.stringify(goal.prerequisites),
      created_at: goal.createdAt,
    });
    expect("updated_at" in row).toBe(false);
    expect(rowToGoal({ ...row, updated_at: goal.updatedAt } as never)).toEqual(goal);
  });

  it("omits null note and defaults null prerequisites", () => {
    expect(
      rowToGoal({
        id: "goal-1",
        title: "长期身体",
        kind: "theme",
        status: "active",
        note: null,
        prerequisites: null,
        created_at: now,
        updated_at: now,
      }),
    ).toEqual({
      id: "goal-1",
      title: "长期身体",
      kind: "theme",
      status: "active",
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });
  });
});
