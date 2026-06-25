import { describe, expect, it } from "vitest";
import { goalGalaxyLayout } from "./goalGalaxyLayout.js";
import { goalGraphLayout } from "./goalGraphLayout.js";
import type { GalaxyModel } from "./goalGalaxyModel.js";
import type { GoalGraphNodeBox } from "./goalGraphLayout.js";

function model(stars: string[], nodes: Array<{ id: string; anchorIds: string[] }>, edges = []): GalaxyModel {
  return {
    stars: stars.map((nodeId) => ({
      nodeId,
      goalId: nodeId.slice("goal:".length),
      title: nodeId,
      completed: 0,
      total: 1,
      memberCount: 1,
      lod: "expanded",
    })),
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: "task",
      title: node.id,
      anchorIds: node.anchorIds,
      lod: "expanded",
      status: "ready",
      ref: { kind: "task", id: node.id.slice("task:".length) },
    })),
    edges,
  };
}

function visualRect(position: { x: number; y: number }, box: GoalGraphNodeBox) {
  const center = {
    x: position.x + (box.offsetX ?? 0),
    y: position.y + (box.offsetY ?? 0),
  };
  return {
    left: center.x - box.width / 2,
    right: center.x + box.width / 2,
    top: center.y - box.height / 2,
    bottom: center.y + box.height / 2,
  };
}

function overlapArea(
  leftPosition: { x: number; y: number },
  leftBox: GoalGraphNodeBox,
  rightPosition: { x: number; y: number },
  rightBox: GoalGraphNodeBox,
): number {
  const left = visualRect(leftPosition, leftBox);
  const right = visualRect(rightPosition, rightBox);
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return Math.max(0, width) * Math.max(0, height);
}

function expectNoVisualOverlap(out: ReturnType<typeof goalGalaxyLayout>, ids: string[]): void {
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
      const left = ids[leftIndex];
      const right = ids[rightIndex];
      expect(overlapArea(out.positions[left], out.boxes[left], out.positions[right], out.boxes[right])).toBe(0);
    }
  }
}

describe("goalGalaxyLayout", () => {
  it("is deterministic for the same input", () => {
    const input = {
      model: model(["goal:g1"], [{ id: "task:a", anchorIds: ["goal:g1"] }]),
      anchorCanvasById: { "goal:g1": { x: 100, y: 100 } },
      memberPinByNodeId: {},
    };

    expect(goalGalaxyLayout(input).positions).toEqual(goalGalaxyLayout(input).positions);
  });

  it("places stars on their canvas coordinates", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1"], []),
      anchorCanvasById: { "goal:g1": { x: 100, y: 200 } },
      memberPinByNodeId: {},
    });

    expect(out.positions["goal:g1"]).toEqual({ x: 100, y: 200 });
  });

  it("pushes overlapping unpinned stars away from each other", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], []),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 0, y: 0 } },
      memberPinByNodeId: {},
    });

    expect(out.positions["goal:g1"]).not.toEqual(out.positions["goal:g2"]);
    expectNoVisualOverlap(out, ["goal:g1", "goal:g2"]);
  });

  it("keeps pinned stars fixed while pushing overlapping unpinned stars away", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], []),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 0, y: 0 } },
      pinnedAnchorIds: new Set(["goal:g1"]),
      memberPinByNodeId: {},
    });

    expect(out.positions["goal:g1"]).toEqual({ x: 0, y: 0 });
    expect(out.positions["goal:g2"]).not.toEqual({ x: 0, y: 0 });
    expectNoVisualOverlap(out, ["goal:g1", "goal:g2"]);
  });

  it("reflows single-goal members around their star after automatic star avoidance", () => {
    const seed = goalGraphLayout(
      {
        goalNodeId: "goal",
        nodes: [
          { id: "goal", kind: "goal" },
          { id: "task:a", kind: "task" },
        ],
        edges: [{ source: "goal", target: "task:a", kind: "tether" }],
      },
      { orientation: "horizontal" },
    ).positions["task:a"];
    const out = goalGalaxyLayout({
      model: model(
        ["goal:g1", "goal:g2"],
        [
          { id: "task:a", anchorIds: ["goal:g1"] },
          { id: "task:b", anchorIds: ["goal:g2"] },
        ],
      ),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 0, y: 0 } },
      memberPinByNodeId: {},
    });

    expect(out.positions["goal:g1"]).not.toEqual(out.positions["goal:g2"]);
    expect(out.positions["task:a"].x - out.positions["goal:g1"].x).toBeCloseTo(seed.x);
    expect(out.positions["task:a"].y - out.positions["goal:g1"].y).toBeCloseTo(seed.y);
    expect(out.positions["task:b"].x - out.positions["goal:g2"].x).toBeCloseTo(seed.x);
    expect(out.positions["task:b"].y - out.positions["goal:g2"].y).toBeCloseTo(seed.y);
    expectNoVisualOverlap(out, ["goal:g1", "goal:g2", "task:a", "task:b"]);
  });

  it("keeps a bridge task's visible label box away from nearby goal stars", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], [{ id: "task:a", anchorIds: ["goal:g1", "goal:g2"] }]),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 460, y: 0 } },
      memberPinByNodeId: {},
    });

    expectNoVisualOverlap(out, ["goal:g1", "goal:g2", "task:a"]);
  });

  it("keeps an unpinned goal star away from another goal's pinned member", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], [{ id: "task:a", anchorIds: ["goal:g1"] }]),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 0, y: -296 } },
      memberPinByNodeId: {
        "goal:g1|task:a": { goalId: "g1", x: 0, y: -296 },
      },
    });

    expect(out.positions["task:a"]).toEqual({ x: 0, y: -296 });
    expect(out.positions["goal:g2"]).not.toEqual({ x: 0, y: -296 });
    expectNoVisualOverlap(out, ["goal:g2", "task:a"]);
  });

  it("places a bridge node near the centroid of its anchors", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], [{ id: "task:a", anchorIds: ["goal:g1", "goal:g2"] }]),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 400, y: 0 } },
      memberPinByNodeId: {},
    });

    expect(out.positions["task:a"].x).toBeGreaterThan(120);
    expect(out.positions["task:a"].x).toBeLessThan(280);
  });

  it("uses anchor plus offset for a pinned single-goal member", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1"], [{ id: "task:a", anchorIds: ["goal:g1"] }]),
      anchorCanvasById: { "goal:g1": { x: 100, y: 100 } },
      memberPinByNodeId: { "task:a": { goalId: "g1", x: 30, y: -10 } },
    });

    expect(out.positions["task:a"]).toEqual({ x: 130, y: 90 });
  });

  it("uses the pin matching the member's single anchor when the same member has pins in multiple goals", () => {
    const out = goalGalaxyLayout({
      model: model(["goal:g1", "goal:g2"], [{ id: "task:a", anchorIds: ["goal:g1"] }]),
      anchorCanvasById: { "goal:g1": { x: 100, y: 100 }, "goal:g2": { x: 500, y: 500 } },
      memberPinByNodeId: {
        "goal:g1|task:a": { goalId: "g1", x: 30, y: -10 },
        "goal:g2|task:a": { goalId: "g2", x: 300, y: 300 },
      },
    });

    expect(out.positions["task:a"]).toEqual({ x: 130, y: 90 });
  });

  it("pushes a movable overlapping member away from a pinned member", () => {
    const out = goalGalaxyLayout({
      model: model(
        ["goal:g1", "goal:g2"],
        [
          { id: "task:a", anchorIds: ["goal:g1"] },
          { id: "task:b", anchorIds: ["goal:g1", "goal:g2"] },
        ],
      ),
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 500, y: 0 } },
      memberPinByNodeId: {
        "task:a": { goalId: "g1", x: 250, y: 0 },
      },
    });

    const a = out.positions["task:a"];
    const b = out.positions["task:b"];
    expect(a).toEqual({ x: 250, y: 0 });
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(10);
  });
});
