import { describe, expect, it } from "vitest";
import { computeRanks, goalGraphLayout, type GoalGraphModelLike } from "./goalGraphLayout.js";

type GoalGraphModel = {
  goalNodeId: string;
  nodes: Array<{ id: string }>;
  edges: Array<{
    id: string;
    kind: "prerequisite" | "broken-prerequisite" | "tether";
    source: string;
    target: string;
  }>;
};

function buildModel(): GoalGraphModel {
  return {
    goalNodeId: "goal",
    nodes: [{ id: "goal" }, { id: "blocker" }, { id: "blocked" }, { id: "tether" }],
    edges: [
      { id: "e1", kind: "prerequisite", source: "blocker", target: "blocked" },
      { id: "e2", kind: "tether", source: "goal", target: "tether" },
    ],
  };
}

const runtimeModel = (): GoalGraphModelLike => buildModel() satisfies GoalGraphModelLike;

describe("goalGraphLayout", () => {
  it("source/target 的 prerequisite 链进入 dependency lane，tether 仅走 orbit", () => {
    expect(computeRanks(runtimeModel())).toEqual({
      blocker: 0,
      blocked: 1,
    });

    const horizontal = goalGraphLayout(runtimeModel(), {
      orientation: "horizontal",
      rankGap: 100,
      nodeGap: 40,
      orbitRadius: 120,
    });

    expect(horizontal.orientation).toBe("horizontal");
    expect(horizontal.positions.goal).toEqual({ x: 0, y: 0 });
    expect(horizontal.positions.blocker).toEqual({ x: 100, y: 0 });
    expect(horizontal.positions.blocked).toEqual({ x: 200, y: 0 });
    expect(Math.hypot(horizontal.positions.tether.x, horizontal.positions.tether.y)).toBeCloseTo(120, 5);
    expect(horizontal.positions.tether.x).not.toBe(0);
    expect(horizontal.positions.tether.y).not.toBe(0);
  });

  it("纵向布局时 prerequisite 链按 blocker -> blocked 排 rank，lane 方向切到 top->bottom", () => {
    const vertical = goalGraphLayout(runtimeModel(), {
      orientation: "vertical",
      rankGap: 90,
      nodeGap: 30,
      orbitRadius: 120,
    });

    expect(vertical.orientation).toBe("vertical");
    expect(vertical.positions.goal).toEqual({ x: 0, y: 0 });
    expect(vertical.positions.blocker).toEqual({ x: 0, y: 90 });
    expect(vertical.positions.blocked).toEqual({ x: 0, y: 180 });
    expect(Math.hypot(vertical.positions.tether.x, vertical.positions.tether.y)).toBeCloseTo(120, 5);
  });
});
