import { describe, expect, it } from "vitest";
import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import { buildGoalOverview } from "./goalsView.js";
import { GOAL_NODE_ID, buildGoalGraphModel, graphNodeId } from "./goalGraphModel.js";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: "2026-06-22T01:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    id: overrides.id,
    parentId: null,
    title: overrides.title ?? overrides.id,
    done: overrides.done ?? false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: overrides.completedAt ?? null,
    tags: [],
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T02:00:00.000Z",
    ...overrides,
  };
}

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "active",
    refs: [],
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T03:00:00.000Z",
    ...overrides,
  };
}

function step(overrides: Partial<TrackStep> & Pick<TrackStep, "id" | "trackId">): TrackStep {
  return {
    id: overrides.id,
    trackId: overrides.trackId,
    source: "agent",
    content: "",
    startedAt: overrides.startedAt ?? "2026-06-22T04:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    refs: [],
    tags: [],
    seq: overrides.seq ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-22T04:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T04:00:00.000Z",
    ...overrides,
  };
}

describe("goalGraphModel", () => {
  it("uses stable goal and ghost ids without colliding with real member ids", () => {
    const overview = buildGoalOverview(
      goal({
        members: [
          { kind: "task", id: "t1" },
          { kind: "task", id: "missing" },
          { kind: "track", id: "track-missing" },
        ],
        prerequisites: [
          {
            blocker: { kind: "task", id: "missing" },
            blocked: { kind: "task", id: "t1" },
          },
          {
            blocker: { kind: "task", id: "t1" },
            blocked: { kind: "track", id: "track-missing" },
          },
        ],
      }),
      [task({ id: "t1", title: "真实任务" })],
      [],
      [],
    );

    const model = buildGoalGraphModel(overview);
    const nodeIds = model.nodes.map((node) => node.id);

    expect(GOAL_NODE_ID).toBe("goal");
    expect(graphNodeId({ kind: "task", id: "t1" })).toBe("task:t1");
    expect(nodeIds).toContain("task:t1");
    expect(nodeIds).toContain("ghost:task:missing");
    expect(nodeIds).toContain("ghost:track:track-missing");
    expect(nodeIds).not.toContain("task:missing");
    expect(nodeIds).not.toContain("track:track-missing");
    expect(model.edges).toContainEqual({
      id: "tether:goal->ghost:task:missing",
      kind: "tether",
      source: "goal",
      target: "ghost:task:missing",
    });
    expect(model.edges).toContainEqual({
      id: "broken-prerequisite:ghost:task:missing->task:t1",
      kind: "broken-prerequisite",
      source: "ghost:task:missing",
      target: "task:t1",
    });
    expect(model.edges).toContainEqual({
      id: "broken-prerequisite:task:t1->ghost:track:track-missing",
      kind: "broken-prerequisite",
      source: "task:t1",
      target: "ghost:track:track-missing",
    });
    expect(model.nodes.find((node) => node.id === "task:t1")).toMatchObject({ hasDependency: true });
    expect(model.nodes.find((node) => node.id === "ghost:task:missing")).toMatchObject({ hasDependency: true });
    expect(model.nodes.find((node) => node.id === "ghost:track:track-missing")).toMatchObject({ hasDependency: true });
  });

  it("builds goal, member, and ghost nodes with tether and prerequisite edges", () => {
    const overview = buildGoalOverview(
      goal({
        members: [
          { kind: "task", id: "task-blocker" },
          { kind: "track", id: "track-ready" },
          { kind: "track", id: "track-missing" },
        ],
        prerequisites: [
          {
            blocker: { kind: "task", id: "task-blocker" },
            blocked: { kind: "track", id: "track-ready" },
          },
          {
            blocker: { kind: "task", id: "task-blocker" },
            blocked: { kind: "track", id: "track-missing" },
          },
        ],
      }),
      [task({ id: "task-blocker", title: "写文案" })],
      [track({ id: "track-ready", title: "发布轨道", status: "active" })],
      [step({ id: "step-ready", trackId: "track-ready", endedAt: "2026-06-22T10:00:00.000Z" })],
    );

    const model = buildGoalGraphModel(overview);

    expect(graphNodeId({ kind: "task", id: "task-blocker" })).toBe("task:task-blocker");
    expect(model.goalNodeId).toBe(GOAL_NODE_ID);
    expect(model.summary).toEqual({ ready: 1, blocked: 1, completed: 0 });
    expect(model.nodes).toEqual([
      {
        id: GOAL_NODE_ID,
        kind: "goal",
        status: "anchor",
        title: "发布 v2",
        ref: null,
        hasDependency: false,
      },
      {
        id: "task:task-blocker",
        kind: "task",
        status: "ready",
        title: "写文案",
        ref: { kind: "task", id: "task-blocker" },
        hasDependency: true,
      },
      {
        id: "track:track-ready",
        kind: "track",
        status: "blocked",
        title: "发布轨道",
        ref: { kind: "track", id: "track-ready" },
        hasDependency: true,
      },
      {
        id: "ghost:track:track-missing",
        kind: "ghost",
        status: "ghost",
        title: "track:track-missing",
        ref: { kind: "track", id: "track-missing" },
        hasDependency: true,
      },
    ]);
    expect(model.edges).toEqual([
      {
        id: "tether:goal->task:task-blocker",
        kind: "tether",
        source: GOAL_NODE_ID,
        target: "task:task-blocker",
      },
      {
        id: "tether:goal->track:track-ready",
        kind: "tether",
        source: GOAL_NODE_ID,
        target: "track:track-ready",
      },
      {
        id: "tether:goal->ghost:track:track-missing",
        kind: "tether",
        source: GOAL_NODE_ID,
        target: "ghost:track:track-missing",
      },
      {
        id: "prerequisite:task:task-blocker->track:track-ready",
        kind: "prerequisite",
        source: "task:task-blocker",
        target: "track:track-ready",
      },
      {
        id: "broken-prerequisite:task:task-blocker->ghost:track:track-missing",
        kind: "broken-prerequisite",
        source: "task:task-blocker",
        target: "ghost:track:track-missing",
      },
    ]);
  });

  it("marks completed and parked members with their source status", () => {
    const overview = buildGoalOverview(
      goal({
        members: [
          { kind: "task", id: "task-done" },
          { kind: "track", id: "track-parked" },
        ],
      }),
      [task({ id: "task-done", title: "已完成", done: true, completedAt: "2026-06-22T09:00:00.000Z" })],
      [track({ id: "track-parked", title: "已搁置", status: "parked" })],
      [],
    );

    const model = buildGoalGraphModel(overview);

    expect(model.summary).toEqual({ ready: 1, blocked: 0, completed: 1 });
    expect(model.nodes).toEqual([
      {
        id: GOAL_NODE_ID,
        kind: "goal",
        status: "anchor",
        title: "发布 v2",
        ref: null,
        hasDependency: false,
      },
      {
        id: "task:task-done",
        kind: "task",
        status: "completed",
        title: "已完成",
        ref: { kind: "task", id: "task-done" },
        hasDependency: false,
      },
      {
        id: "track:track-parked",
        kind: "track",
        status: "parked",
        title: "已搁置",
        ref: { kind: "track", id: "track-parked" },
        hasDependency: false,
      },
    ]);
  });
});
