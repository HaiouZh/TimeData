import { describe, expect, it } from "vitest";
import type { GalaxyModel } from "../../lib/goalGalaxyModel.js";
import { buildGalaxySettleInput } from "./buildGalaxySettleInput.js";

const BOX = { width: 180, height: 56 };

function model(): GalaxyModel {
  return {
    stars: [
      { nodeId: "goal:g1", goalId: "g1", title: "G1", completed: 0, total: 0, memberCount: 1, lod: "expanded" },
      { nodeId: "goal:g2", goalId: "g2", title: "G2", completed: 0, total: 0, memberCount: 1, lod: "expanded" },
    ],
    nodes: [
      {
        id: "task:a",
        kind: "task",
        title: "A",
        anchorIds: ["goal:g1", "goal:g2"],
        lod: "expanded",
        status: "open",
        ref: { kind: "task", id: "a" },
      },
      {
        id: "task:b",
        kind: "task",
        title: "B",
        anchorIds: ["goal:g1"],
        lod: "expanded",
        status: "open",
        ref: { kind: "task", id: "b" },
      },
    ],
    edges: [{ id: "tether:goal:g1->task:b", kind: "tether", source: "goal:g1", target: "task:b" }],
  };
}

function args() {
  const starBox = { width: 144, height: 144 };
  return {
    model: model(),
    seedPositions: {
      "goal:g1": { x: 0, y: 0 },
      "goal:g2": { x: 500, y: 0 },
      "task:a": { x: 250, y: 0 },
      "task:b": { x: 60, y: 0 },
    },
    boxes: { "goal:g1": starBox, "goal:g2": starBox, "task:a": BOX, "task:b": BOX },
    pinnedMemberIds: new Set<string>(),
    anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 500, y: 0 } },
  };
}

describe("buildGalaxySettleInput", () => {
  it("marks every star fixed regardless of pin (settle only arranges members)", () => {
    const input = buildGalaxySettleInput(args());
    expect(input.nodes.find((node) => node.id === "goal:g1")?.fixed).toBe(true);
    expect(input.nodes.find((node) => node.id === "goal:g2")?.fixed).toBe(true);
  });

  it("uses member pins as seeds but does not lock them in settle mode", () => {
    const pinned = buildGalaxySettleInput({ ...args(), pinnedMemberIds: new Set<string>(["goal:g1|task:b"]) });
    expect(pinned.nodes.find((node) => node.id === "task:b")?.fixed).toBe(false);
    expect(buildGalaxySettleInput(args()).nodes.find((node) => node.id === "task:b")?.fixed).toBe(false);
  });

  it("uses resolved star positions as live settle anchor centers", () => {
    const input = buildGalaxySettleInput({
      ...args(),
      seedPositions: {
        ...args().seedPositions,
        "goal:g1": { x: 0, y: 320 },
      },
      anchorCanvasById: { "goal:g1": { x: 0, y: 0 }, "goal:g2": { x: 500, y: 0 } },
    });

    expect(input.anchorById["goal:g1"]).toEqual({ x: 0, y: 320 });
  });

  it("gives single-goal members a primary anchor and carries bridge member anchors", () => {
    const input = buildGalaxySettleInput(args());
    expect(input.nodes.find((node) => node.id === "task:b")?.anchorId).toBe("goal:g1");
    expect(input.nodes.find((node) => node.id === "task:b")).toMatchObject({ anchorIds: ["goal:g1"] });
    expect(input.nodes.find((node) => node.id === "task:a")?.anchorId).toBeUndefined();
    expect(input.nodes.find((node) => node.id === "task:a")).toMatchObject({ anchorIds: ["goal:g1", "goal:g2"] });
  });

  it("derives a bridge link from each star to a multi-anchor member", () => {
    const input = buildGalaxySettleInput(args());
    const bridge = input.links
      .filter((link) => link.kind === "bridge" && link.target === "task:a")
      .map((link) => link.source)
      .sort();
    expect(bridge).toEqual(["goal:g1", "goal:g2"]);
  });

  it("carries through tether links from the model edges", () => {
    const input = buildGalaxySettleInput(args());
    expect(input.links).toContainEqual({ source: "goal:g1", target: "task:b", kind: "tether" });
  });
});
