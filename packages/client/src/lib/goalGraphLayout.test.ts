import { describe, expect, it } from "vitest";
import { computeRanks, goalGraphLayout, type GoalGraphModelLike } from "./goalGraphLayout.js";

type GoalGraphModel = {
  goalNodeId: string;
  nodes: Array<{ id: string; kind?: "goal" | "task" | "track" | "ghost" }>;
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
    nodes: [{ id: "goal", kind: "goal" }, { id: "blocker", kind: "task" }, { id: "blocked", kind: "task" }, { id: "tether", kind: "track" }],
    edges: [
      { id: "e1", kind: "prerequisite", source: "blocker", target: "blocked" },
      { id: "e2", kind: "tether", source: "goal", target: "tether" },
    ],
  };
}

const runtimeModel = (): GoalGraphModelLike => buildModel() satisfies GoalGraphModelLike;

function rectFor(layout: ReturnType<typeof goalGraphLayout>, id: string) {
  const box = layout.boxes[id];
  const pos = layout.positions[id];
  return {
    left: pos.x - box.width / 2,
    right: pos.x + box.width / 2,
    top: pos.y - box.height / 2,
    bottom: pos.y + box.height / 2,
  };
}

function intersects(a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function expectNoOverlap(layout: ReturnType<typeof goalGraphLayout>, ids: string[]) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      expect(intersects(rectFor(layout, ids[i]), rectFor(layout, ids[j])), `${ids[i]} overlaps ${ids[j]}`).toBe(false);
    }
  }
}

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
    expect(horizontal.positions.blocker.x).toBeGreaterThan(horizontal.positions.goal.x);
    expect(horizontal.positions.blocked.x).toBeGreaterThan(horizontal.positions.blocker.x);
    expect(horizontal.positions.blocker.y).toBe(0);
    expect(horizontal.positions.blocked.y).toBe(0);
    expect(Math.hypot(horizontal.positions.tether.x, horizontal.positions.tether.y)).toBeGreaterThan(0);
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
    expect(vertical.positions.blocker.y).toBeGreaterThan(vertical.positions.goal.y);
    expect(vertical.positions.blocked.y).toBeGreaterThan(vertical.positions.blocker.y);
    expect(vertical.positions.blocker.x).toBe(0);
    expect(vertical.positions.blocked.x).toBe(0);
    expect(Math.hypot(vertical.positions.tether.x, vertical.positions.tether.y)).toBeGreaterThan(0);
  });

  it("宽屏 dependency lane 同 rank 多节点不重叠", () => {
    const model: GoalGraphModelLike = {
      goalNodeId: "goal",
      nodes: [
        { id: "goal", kind: "goal" },
        { id: "task:a", kind: "task" },
        { id: "track:b", kind: "track" },
        { id: "task:c", kind: "task" },
      ],
      edges: [
        { kind: "prerequisite", source: "task:a", target: "task:c" },
        { kind: "prerequisite", source: "track:b", target: "task:c" },
      ],
    };

    const layout = goalGraphLayout(model, { orientation: "horizontal" });

    expectNoOverlap(layout, model.nodes.map((node) => node.id));
  });

  it("多个 orbit 节点围绕 Goal 展开且不重叠", () => {
    const model: GoalGraphModelLike = {
      goalNodeId: "goal",
      nodes: [
        { id: "goal", kind: "goal" },
        { id: "task:a", kind: "task" },
        { id: "task:b", kind: "task" },
        { id: "track:c", kind: "track" },
        { id: "track:d", kind: "track" },
      ],
      edges: [{ kind: "tether", source: "goal", target: "task:a" }],
    };

    const layout = goalGraphLayout(model, { orientation: "horizontal" });

    expectNoOverlap(layout, model.nodes.map((node) => node.id));
  });
});
