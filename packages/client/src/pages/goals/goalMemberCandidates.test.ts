import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  buildGoalTaskCandidates,
  buildGoalTrackCandidates,
  taskCandidateGroups,
  trackCandidateGroups,
} from "./goalMemberCandidates.js";

const now = new Date("2026-06-23T08:00:00.000Z");

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
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...input,
  };
}

function track(input: Partial<Track> & Pick<Track, "id" | "title">): Track {
  return {
    id: input.id,
    title: input.title,
    status: "active",
    refs: [],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
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
    startedAt: "2026-06-20T00:00:00.000Z",
    endedAt: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...input,
  };
}

describe("goalMemberCandidates", () => {
  it("任务候选过滤已加入成员并按今天/收件箱/已排期/重复/已完成分组", () => {
    const members: GoalMemberRef[] = [{ kind: "task", id: "joined" }];
    const tasks = [
      task({ id: "joined", title: "已加入" }),
      task({ id: "today", title: "今天", scheduledAt: "2026-06-23T00:00:00.000Z", sortOrder: 2 }),
      task({ id: "inbox", title: "收件箱", scheduledAt: null, sortOrder: 1 }),
      task({ id: "future", title: "未来", scheduledAt: "2026-06-25T00:00:00.000Z" }),
      task({ id: "done", title: "完成", done: true, completedAt: "2026-06-22T00:00:00.000Z" }),
      task({ id: "repeat", title: "重复", recurrence: { freq: "daily", interval: 1, basis: "due" }, startAt: "2026-06-24T00:00:00.000Z" }),
    ];

    const candidates = buildGoalTaskCandidates(tasks, members, {
      now,
      searchQuery: "",
      includeTags: [],
      excludeTags: [],
      tagMode: "and",
    });

    expect(taskCandidateGroups(candidates).map((group) => [group.key, group.items.map((item) => item.task.id)])).toEqual([
      ["today", ["today"]],
      ["inbox", ["inbox"]],
      ["scheduled", ["future"]],
      ["recurring", ["repeat"]],
      ["completed", ["done"]],
    ]);
  });

  it("任务候选复用搜索和标签筛选", () => {
    const tasks = [
      task({ id: "a", title: "写星图", tags: ["goal"] }),
      task({ id: "b", title: "写周报", tags: ["report"] }),
    ];

    const candidates = buildGoalTaskCandidates(tasks, [], {
      now,
      searchQuery: "星图",
      includeTags: ["goal"],
      excludeTags: [],
      tagMode: "and",
    });

    expect(candidates.map((item) => item.task.id)).toEqual(["a"]);
  });

  it("轨道候选 active 优先并带最新步骤和看板信号", () => {
    const tracks = [
      track({ id: "old", title: "归档", status: "concluded", updatedAt: "2026-06-22T00:00:00.000Z" }),
      track({ id: "active", title: "活跃", status: "active", updatedAt: "2026-06-20T00:00:00.000Z" }),
    ];
    const steps = [step({ id: "s1", trackId: "active", seq: 0, content: "等确认", tags: ["待我处理"] })];

    const candidates = buildGoalTrackCandidates(tracks, steps, [], {
      searchQuery: "",
      boardSignals: ["待我处理", "agent在做"],
    });

    expect(trackCandidateGroups(candidates).map((group) => [group.key, group.items.map((item) => item.track.id)])).toEqual([
      ["active", ["active"]],
      ["concluded", ["old"]],
    ]);
    expect(candidates[0]?.latestStep?.content).toBe("等确认");
    expect(candidates[0]?.signal?.tag).toBe("待我处理");
  });
});
