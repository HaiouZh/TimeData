import { describe, expect, it } from "vitest";
import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import {
  THEME_ACTIVITY_WINDOW_DAYS,
  buildGoalOverview,
  goalMemberActivityAt,
  goalMembers,
  splitGoalMembers,
} from "./goalsView.js";

const now = "2026-06-22T12:00:00.000Z";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
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
    goalId: "goal-1",
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
    goalId: "goal-1",
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

describe("goalsView", () => {
  it("collects goal tasks/tracks and computes project progress by completed members", () => {
    const overview = buildGoalOverview(
      goal(),
      [task({ id: "task-done", done: true, completedAt: "2026-06-22T08:00:00.000Z" }), task({ id: "task-open" })],
      [track({ id: "track-done", status: "concluded" }), track({ id: "track-open", status: "active" })],
      [],
    );

    expect(overview.members.map((member) => member.id)).toEqual(["task-done", "task-open", "track-done", "track-open"]);
    expect(overview.progress).toEqual({ kind: "project", completed: 2, total: 4, ratio: 0.5 });
  });

  it("uses 7 days by default for theme activity and keeps lastActivityAt", () => {
    const overview = buildGoalOverview(
      goal({ kind: "theme" }),
      [
        task({ id: "task-recent", updatedAt: "2026-06-21T12:00:00.000Z" }),
        task({ id: "task-old", updatedAt: "2026-06-10T12:00:00.000Z" }),
      ],
      [track({ id: "track-recent", updatedAt: "2026-06-10T12:00:00.000Z" })],
      [step({ id: "step-recent", trackId: "track-recent", endedAt: "2026-06-22T10:00:00.000Z" })],
      { now: new Date(now) },
    );

    expect(THEME_ACTIVITY_WINDOW_DAYS).toBe(7);
    expect(overview.progress).toEqual({
      kind: "theme",
      activeMemberCount: 2,
      totalMembers: 3,
      lastActivityAt: "2026-06-22T10:00:00.000Z",
      windowDays: 7,
    });
  });

  it("splits ready, blocked, completed members and reports waitingOn blockers", () => {
    const members = goalMembers(
      goal({ prerequisites: [{ blocker: "task-blocker", blocked: "track-blocked" }] }),
      [task({ id: "task-blocker", title: "写文案", done: false })],
      [track({ id: "track-blocked", title: "发布轨道", status: "active" })],
      [],
    );

    const sections = splitGoalMembers(
      goal({ prerequisites: [{ blocker: "task-blocker", blocked: "track-blocked" }] }),
      members,
    );

    expect(sections.ready.map((member) => member.id)).toEqual(["task-blocker"]);
    expect(sections.blocked).toHaveLength(1);
    expect(sections.blocked[0]).toMatchObject({
      id: "track-blocked",
      waitingOn: [expect.objectContaining({ id: "task-blocker", title: "写文案" })],
    });
    expect(sections.completed).toEqual([]);
  });

  it("ignores prerequisite edges that point outside current goal members", () => {
    const sections = splitGoalMembers(
      goal({ prerequisites: [{ blocker: "missing", blocked: "task-1" }] }),
      [goalMembers(goal(), [task({ id: "task-1" })], [], [])[0]],
    );

    expect(sections.ready.map((member) => member.id)).toEqual(["task-1"]);
    expect(sections.ignoredPrerequisites).toEqual([{ blocker: "missing", blocked: "task-1" }]);
  });

  it("derives activity from completedAt for tasks and latest step time for tracks", () => {
    const completedTask = goalMembers(goal(), [task({ id: "task-1", done: true, completedAt: "2026-06-22T09:00:00.000Z" })], [], [])[0];
    const trackMember = goalMembers(
      goal(),
      [],
      [track({ id: "track-1", updatedAt: "2026-06-22T03:00:00.000Z" })],
      [
        step({ id: "step-1", trackId: "track-1", endedAt: "2026-06-22T08:00:00.000Z" }),
        step({ id: "step-2", trackId: "track-1", startedAt: "2026-06-22T10:00:00.000Z" }),
      ],
    )[0];

    expect(goalMemberActivityAt(completedTask)).toBe("2026-06-22T09:00:00.000Z");
    expect(goalMemberActivityAt(trackMember)).toBe("2026-06-22T10:00:00.000Z");
  });
});
