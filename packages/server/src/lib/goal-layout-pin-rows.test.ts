import { describe, expect, it } from "vitest";
import { goalLayoutPinToRow, rowToGoalLayoutPin } from "./goal-layout-pin-rows.js";

describe("goal layout pin row mapping", () => {
  it("maps camelCase pins to snake_case rows", () => {
    expect(
      goalLayoutPinToRow({
        goalId: "goal-1",
        nodeKind: "task",
        nodeId: "task-1",
        x: 12.5,
        y: -8,
        updatedAt: "2026-06-24T00:00:00.000Z",
      }),
    ).toEqual({
      goal_id: "goal-1",
      node_kind: "task",
      node_id: "task-1",
      x: 12.5,
      y: -8,
    });
  });

  it("maps snake_case rows back to typed pins", () => {
    expect(
      rowToGoalLayoutPin({
        goal_id: "goal-1",
        node_kind: "track",
        node_id: "track-1",
        x: 100,
        y: 200,
        updated_at: "2026-06-24T00:00:00.000Z",
      }),
    ).toEqual({
      goalId: "goal-1",
      nodeKind: "track",
      nodeId: "track-1",
      x: 100,
      y: 200,
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
  });
});
