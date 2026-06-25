import type { Goal, Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildGoalGalaxyModel } from "./goalGalaxyModel.js";

function task(id: string, done = false): Task {
  return {
    id,
    title: id,
    done,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Task;
}

function projectGoal(id: string, taskIds: string[]): Goal {
  return {
    id,
    title: id,
    kind: "project",
    status: "active",
    members: taskIds.map((taskId) => ({ kind: "task", id: taskId })),
    prerequisites: [],
  } as Goal;
}

const expand = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, "expanded" as const]));

describe("buildGoalGalaxyModel", () => {
  it("returns an empty model for an empty goal list", () => {
    expect(buildGoalGalaxyModel({ goals: [], tasks: [], tracks: [], steps: [], lodByGoalId: {} })).toEqual({
      stars: [],
      nodes: [],
      edges: [],
    });
  });

  it("keeps member topology for a collapsed goal", () => {
    const goals = [projectGoal("g1", ["a"])];

    const model = buildGoalGalaxyModel({
      goals,
      tasks: [task("a")],
      tracks: [],
      steps: [],
      lodByGoalId: { g1: "collapsed" },
    });

    expect(model.stars.map((star) => star.nodeId)).toEqual(["goal:g1"]);
    expect(model.stars[0]).toMatchObject({
      goalId: "g1",
      total: 1,
      completed: 0,
      memberCount: 1,
      lod: "collapsed",
    });
    expect(model.nodes.map((node) => node.id)).toEqual(["task:a"]);
    expect(model.edges.some((edge) => edge.kind === "tether" && edge.source === "goal:g1" && edge.target === "task:a")).toBe(true);
  });

  it("creates member nodes and tether edges for an expanded goal", () => {
    const goals = [projectGoal("g1", ["a"])];

    const model = buildGoalGalaxyModel({
      goals,
      tasks: [task("a")],
      tracks: [],
      steps: [],
      lodByGoalId: expand("g1"),
    });

    expect(model.nodes.map((node) => node.id)).toEqual(["task:a"]);
    expect(model.nodes[0].anchorIds).toEqual(["goal:g1"]);
    expect(model.edges.some((edge) => edge.kind === "tether" && edge.source === "goal:g1" && edge.target === "task:a")).toBe(true);
  });

  it("merges a shared task into one bridge node connected to both anchors", () => {
    const goals = [projectGoal("g1", ["a"]), projectGoal("g2", ["a"])];

    const model = buildGoalGalaxyModel({
      goals,
      tasks: [task("a")],
      tracks: [],
      steps: [],
      lodByGoalId: expand("g1", "g2"),
    });

    const node = model.nodes.find((item) => item.id === "task:a");

    expect(model.nodes.filter((item) => item.id === "task:a")).toHaveLength(1);
    expect(node?.anchorIds.sort()).toEqual(["goal:g1", "goal:g2"]);
    expect(model.edges.filter((edge) => edge.kind === "tether" && edge.target === "task:a").map((edge) => edge.source).sort()).toEqual([
      "goal:g1",
      "goal:g2",
    ]);
  });

  it("ignores archived goals", () => {
    const goals = [{ ...projectGoal("g1", ["a"]), status: "archived" } as Goal];

    const model = buildGoalGalaxyModel({
      goals,
      tasks: [task("a")],
      tracks: [],
      steps: [],
      lodByGoalId: expand("g1"),
    });

    expect(model.stars).toEqual([]);
  });
});
