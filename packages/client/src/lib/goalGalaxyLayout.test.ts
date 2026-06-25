import { describe, expect, it } from "vitest";
import { goalGalaxyLayout } from "./goalGalaxyLayout.js";
import type { GalaxyModel } from "./goalGalaxyModel.js";

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
      status: "ready",
      ref: { kind: "task", id: node.id.slice("task:".length) },
    })),
    edges,
  };
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
