import { describe, expect, it } from "vitest";
import { pinRefFromNodeId } from "./goalLayoutPinRefs.js";

describe("pinRefFromNodeId", () => {
  it("maps goal anchor to a goal world pin ref", () => {
    expect(pinRefFromNodeId("goal", "goal-1")).toEqual({
      goalId: "goal-1",
      nodeKind: "goal",
      nodeId: "goal-1",
    });
  });

  it("maps task and track nodes to member pin refs", () => {
    expect(pinRefFromNodeId("task:task-1", "goal-1")).toEqual({
      goalId: "goal-1",
      nodeKind: "task",
      nodeId: "task-1",
    });
    expect(pinRefFromNodeId("track:track-1", "goal-1")).toEqual({
      goalId: "goal-1",
      nodeKind: "track",
      nodeId: "track-1",
    });
  });

  it("does not map ghost or malformed nodes", () => {
    expect(pinRefFromNodeId("ghost:task:missing", "goal-1")).toBeNull();
    expect(pinRefFromNodeId("unknown:x", "goal-1")).toBeNull();
  });
});
