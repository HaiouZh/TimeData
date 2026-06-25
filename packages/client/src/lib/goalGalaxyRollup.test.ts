import type { Goal, Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { goalGalaxyRollup } from "./goalGalaxyRollup.js";

const now = new Date("2026-06-25T00:00:00.000Z");
const recent = "2026-06-24T00:00:00.000Z";
const old = "2026-01-01T00:00:00.000Z";

function task(id: string, done: boolean, updatedAt: string): Task {
  return { id, title: id, done, createdAt: old, updatedAt, completedAt: done ? updatedAt : undefined } as Task;
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

describe("goalGalaxyRollup", () => {
  it("returns zeros for an empty goal list", () => {
    expect(goalGalaxyRollup([], [], [], [], { now })).toEqual({
      completed: 0,
      total: 0,
      ratio: 0,
      weekActiveMembers: 0,
      activeGoals: 0,
    });
  });

  it("sums completed and total counts across project goals", () => {
    const goals = [projectGoal("g1", ["a", "b"]), projectGoal("g2", ["c"])];
    const tasks = [task("a", true, recent), task("b", false, old), task("c", true, recent)];

    const rollup = goalGalaxyRollup(goals, tasks, [], [], { now });

    expect(rollup.completed).toBe(2);
    expect(rollup.total).toBe(3);
    expect(rollup.ratio).toBeCloseTo(2 / 3);
  });

  it("deduplicates week-active members while counting each active goal with momentum", () => {
    const goals = [projectGoal("g1", ["a"]), projectGoal("g2", ["a"])];
    const tasks = [task("a", false, recent)];

    const rollup = goalGalaxyRollup(goals, tasks, [], [], { now });

    expect(rollup.weekActiveMembers).toBe(1);
    expect(rollup.activeGoals).toBe(2);
  });

  it("ignores archived goals", () => {
    const active = projectGoal("g1", ["a"]);
    const archived = { ...projectGoal("g2", ["b"]), status: "archived" } as Goal;
    const tasks = [task("a", true, recent), task("b", true, recent)];

    const rollup = goalGalaxyRollup([active, archived], tasks, [], [], { now });

    expect(rollup.total).toBe(1);
  });
});
