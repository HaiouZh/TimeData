import { describe, expect, it } from "vitest";
import { galaxyPinRef } from "./galaxyPinRef.js";

describe("galaxyPinRef", () => {
  it("maps a star node to its goal-world pin ref", () => {
    expect(galaxyPinRef("goal:g1", ["g1"])).toEqual({ goalId: "g1", nodeKind: "goal", nodeId: "g1" });
  });

  it("maps a single-goal member to that goal's member pin ref", () => {
    expect(galaxyPinRef("task:t1", ["g1"])).toEqual({ goalId: "g1", nodeKind: "task", nodeId: "t1" });
    expect(galaxyPinRef("track:r1", ["g2"])).toEqual({ goalId: "g2", nodeKind: "track", nodeId: "r1" });
  });

  it("returns null for bridge members owned by multiple goals", () => {
    expect(galaxyPinRef("task:t1", ["g1", "g2"])).toBeNull();
  });

  it("returns null for orphan or abnormal node ids", () => {
    expect(galaxyPinRef("task:t1", [])).toBeNull();
    expect(galaxyPinRef("ghost:task:x", ["g1"])).toBeNull();
    expect(galaxyPinRef("goal:", ["g1"])).toBeNull();
  });
});
