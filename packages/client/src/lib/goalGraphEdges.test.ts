import { describe, expect, it } from "vitest";
import type { GoalMemberRef, GoalPrerequisite } from "@timedata/shared";
import { addPrerequisiteEdge, removePrerequisiteEdge, validatePrerequisiteEdge } from "./goalGraphEdges.js";

type GoalLike = {
  title: string;
  members: GoalMemberRef[];
  prerequisites: GoalPrerequisite[];
};

function goalLike(overrides: Partial<GoalLike> = {}): GoalLike {
  return {
    title: "目标",
    members: [],
    prerequisites: [],
    ...overrides,
  };
}

describe("goalGraphEdges", () => {
  it("rejects self reference", () => {
    const result = validatePrerequisiteEdge(
      goalLike({ members: [{ kind: "task", id: "task-1" }] }),
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-1" },
    );

    expect(result).toEqual({ ok: false, error: "self-reference" });
  });

  it("rejects non-member endpoints", () => {
    const result = validatePrerequisiteEdge(
      goalLike({ members: [{ kind: "task", id: "task-1" }] }),
      { kind: "task", id: "ghost" },
      { kind: "task", id: "task-1" },
    );

    expect(result).toEqual({ ok: false, error: "non-member" });
  });

  it("rejects duplicate edges", () => {
    const result = validatePrerequisiteEdge(
      goalLike({
        members: [
          { kind: "task", id: "task-1" },
          { kind: "track", id: "track-1" },
        ],
        prerequisites: [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
      }),
      { kind: "task", id: "task-1" },
      { kind: "track", id: "track-1" },
    );

    expect(result).toEqual({ ok: false, error: "duplicate" });
  });

  it("rejects cycles", () => {
    const result = validatePrerequisiteEdge(
      goalLike({
        members: [
          { kind: "task", id: "task-1" },
          { kind: "task", id: "task-2" },
          { kind: "track", id: "track-1" },
        ],
        prerequisites: [
          { blocker: { kind: "task", id: "task-1" }, blocked: { kind: "task", id: "task-2" } },
          { blocker: { kind: "task", id: "task-2" }, blocked: { kind: "track", id: "track-1" } },
        ],
      }),
      { kind: "track", id: "track-1" },
      { kind: "task", id: "task-1" },
    );

    expect(result).toEqual({ ok: false, error: "cycle" });
  });

  it("rejects goal anchor endpoints", () => {
    const result = validatePrerequisiteEdge(
      goalLike({ members: [{ kind: "task", id: "task-1" }] }),
      { kind: "goal", id: "goal-1" },
      { kind: "task", id: "task-1" },
    );

    expect(result).toEqual({ ok: false, error: "goal-anchor" });
  });

  it("adds a valid prerequisite edge without mutating the input", () => {
    const source = goalLike({ members: [{ kind: "task", id: "task-1" }, { kind: "track", id: "track-1" }] });

    const next = addPrerequisiteEdge(source, { kind: "task", id: "task-1" }, { kind: "track", id: "track-1" });

    expect(next).not.toBe(source);
    expect(next.prerequisites).toEqual([{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }]);
    expect(source.prerequisites).toEqual([]);
  });

  it("removes a prerequisite edge without mutating the input", () => {
    const source = goalLike({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
      prerequisites: [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
    });

    const next = removePrerequisiteEdge(source, { kind: "task", id: "task-1" }, { kind: "track", id: "track-1" });

    expect(next).not.toBe(source);
    expect(next.prerequisites).toEqual([]);
    expect(source.prerequisites).toEqual([{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }]);
  });
});
