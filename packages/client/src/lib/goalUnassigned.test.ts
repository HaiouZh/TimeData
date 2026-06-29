import type { Goal, GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  activeGoalMemberKeys,
  activeGoalMemberRefs,
  buildUnassignedGoalCandidates,
  goalLinkedTaskIds,
  unassignedTasks,
  unassignedTracks,
} from "./goalUnassigned.js";

const now = "2026-06-26T08:00:00.000Z";

function goal(input: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    id: input.id,
    title: input.title,
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function task(input: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    id: input.id,
    parentId: null,
    title: input.title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function track(input: Partial<Track> & Pick<Track, "id" | "title">): Track {
  return {
    id: input.id,
    title: input.title,
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function step(input: Partial<TrackStep> & Pick<TrackStep, "id" | "trackId" | "seq" | "content">): TrackStep {
  return {
    id: input.id,
    trackId: input.trackId,
    seq: input.seq,
    content: input.content,
    source: "user",
    sourceLabel: null,
    refs: [],
    tags: [],
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

describe("goalUnassigned", () => {
  it("collects member keys only from active goals", () => {
    const keys = activeGoalMemberKeys([
      goal({ id: "active", title: "Active", members: [{ kind: "task", id: "active-task" }] }),
      goal({ id: "archived", title: "Archived", status: "archived", members: [{ kind: "task", id: "archived-task" }] }),
    ]);

    expect(keys.has("task:active-task")).toBe(true);
    expect(keys.has("task:archived-task")).toBe(false);
  });

  it("collects only active goal member refs for the global exclusion set", () => {
    const refs = activeGoalMemberRefs([
      goal({
        id: "active",
        title: "Active",
        members: [
          { kind: "task", id: "active-task" },
          { kind: "track", id: "active-track" },
        ],
      }),
      goal({
        id: "archived",
        title: "Archived",
        status: "archived",
        members: [{ kind: "task", id: "archived-task" }],
      }),
    ]);

    expect(refs).toEqual<GoalMemberRef[]>([
      { kind: "task", id: "active-task" },
      { kind: "track", id: "active-track" },
    ]);
  });

  it("returns unfinished tasks not owned by any active goal", () => {
    const goals = [
      goal({ id: "active", title: "Active", members: [{ kind: "task", id: "owned" }] }),
      goal({ id: "archived", title: "Archived", status: "archived", members: [{ kind: "task", id: "archived-owned" }] }),
    ];

    expect(
      unassignedTasks(
        [
          task({ id: "owned", title: "已归类" }),
          task({ id: "free", title: "自由" }),
          task({ id: "done", title: "完成", done: true, completedAt: now }),
          task({ id: "archived-owned", title: "归档目标成员" }),
        ],
        goals,
      ).map((item) => item.id),
    ).toEqual(["free", "archived-owned"]);
  });

  it("returns active tracks not owned by any active goal", () => {
    const goals = [goal({ id: "active", title: "Active", members: [{ kind: "track", id: "owned" }] })];

    expect(
      unassignedTracks(
        [
          track({ id: "owned", title: "已归类" }),
          track({ id: "free", title: "自由" }),
          track({ id: "parked", title: "暂停", status: "parked" }),
          track({ id: "concluded", title: "完成", status: "concluded" }),
        ],
        goals,
      ).map((item) => item.id),
    ).toEqual(["free"]);
  });

  it("builds the unassigned tray from active unfinished tasks and active tracks not owned by any active goal", () => {
    const candidates = buildUnassignedGoalCandidates({
      goals: [
        goal({ id: "active", title: "Active", members: [{ kind: "task", id: "assigned-task" }] }),
        goal({ id: "archived", title: "Archived", status: "archived", members: [{ kind: "task", id: "archived-task" }] }),
        goal({ id: "track-goal", title: "Track goal", members: [{ kind: "track", id: "assigned-track" }] }),
      ],
      tasks: [
        task({ id: "assigned-task", title: "已归类" }),
        task({ id: "archived-task", title: "归档目标成员回流" }),
        task({ id: "done-task", title: "已完成", done: true, completedAt: now }),
        task({ id: "open-task", title: "开放任务", tags: ["goal"] }),
      ],
      tracks: [
        track({ id: "assigned-track", title: "已归类轨道" }),
        track({ id: "parked-track", title: "暂停轨道", status: "parked" }),
        track({ id: "open-track", title: "开放轨道" }),
      ],
      steps: [step({ id: "s1", trackId: "open-track", seq: 1, content: "最新一步", tags: ["待我处理"] })],
      boardSignals: ["待我处理"],
      now: new Date(now),
      searchQuery: "",
      includeTags: [],
      excludeTags: [],
      tagMode: "and",
    });

    expect(candidates.taskCandidates.map((candidate) => candidate.task.id)).toEqual(["archived-task", "open-task"]);
    expect(candidates.trackCandidates.map((candidate) => candidate.track.id)).toEqual(["open-track"]);
    expect(candidates.trackCandidates[0]?.latestStep?.content).toBe("最新一步");
    expect(candidates.trackCandidates[0]?.signal?.tag).toBe("待我处理");
    expect(candidates.total).toBe(3);
  });

  it("collects task ids referenced by active goals, ignoring tracks and non-active goals", () => {
    const ids = goalLinkedTaskIds([
      goal({
        id: "active",
        title: "Active",
        members: [
          { kind: "task", id: "t1" },
          { kind: "track", id: "r1" },
        ],
      }),
      goal({ id: "active2", title: "Active2", members: [{ kind: "task", id: "t2" }] }),
      goal({ id: "archived", title: "Archived", status: "archived", members: [{ kind: "task", id: "t3" }] }),
    ]);

    expect([...ids].sort()).toEqual(["t1", "t2"]);
    expect(ids.has("r1")).toBe(false);
    expect(ids.has("t3")).toBe(false);
  });

  it("keeps search and tag filtering for tray tasks", () => {
    const candidates = buildUnassignedGoalCandidates({
      goals: [],
      tasks: [
        task({ id: "goal", title: "写星图", tags: ["goal"] }),
        task({ id: "report", title: "写周报", tags: ["report"] }),
      ],
      tracks: [],
      steps: [],
      boardSignals: [],
      now: new Date(now),
      searchQuery: "星图",
      includeTags: ["goal"],
      excludeTags: [],
      tagMode: "and",
    });

    expect(candidates.taskCandidates.map((candidate) => candidate.task.id)).toEqual(["goal"]);
  });
});
