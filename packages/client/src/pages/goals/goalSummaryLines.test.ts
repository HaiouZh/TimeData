import { describe, expect, it } from "vitest";
import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import { buildGoalOverview } from "../../lib/goalsView.js";
import { goalSummaryLines } from "./goalSummaryLines.js";

const now = new Date("2026-06-22T12:00:00.000Z");

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
    sortOrder: 0,
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

function overview(input: { goal: Goal; tasks?: Task[]; tracks?: Track[]; steps?: TrackStep[] }) {
  return buildGoalOverview(input.goal, input.tasks ?? [], input.tracks ?? [], input.steps ?? [], { now });
}

describe("goalSummaryLines", () => {
  it("summarizes active project momentum, frontline, and completion", () => {
    const lines = goalSummaryLines(
      overview({
        goal: goal({
          members: [
            { kind: "task", id: "ready-1" },
            { kind: "task", id: "ready-2" },
            { kind: "task", id: "ready-3" },
            { kind: "track", id: "blocked-1" },
            { kind: "task", id: "done-1" },
          ],
          prerequisites: [
            {
              blocker: { kind: "task", id: "ready-1" },
              blocked: { kind: "track", id: "blocked-1" },
            },
          ],
        }),
        tasks: [
          task({ id: "ready-1", updatedAt: "2026-06-22T08:00:00.000Z" }),
          task({ id: "ready-2" }),
          task({ id: "ready-3" }),
          task({ id: "done-1", done: true, completedAt: "2026-06-20T08:00:00.000Z" }),
        ],
        tracks: [track({ id: "blocked-1" })],
      }),
    );

    expect(lines).toEqual({
      momentum: "在动 · 最近 2026-06-22",
      frontline: "▸ 3 能推 · 1 等前置",
      completion: "✓ 1 完成 · 共 5 项",
    });
  });

  it("summarizes empty, dormant, never-started, and theme goals", () => {
    expect(goalSummaryLines(overview({ goal: goal() }))).toEqual({
      momentum: "还没开始推进",
      frontline: "还没有成员",
      completion: "✓ 0 完成",
    });

    expect(
      goalSummaryLines(
        overview({
          goal: goal({ members: [{ kind: "task", id: "old" }] }),
          tasks: [task({ id: "old", updatedAt: "2026-06-10T12:00:00.000Z" })],
        }),
      ).momentum,
    ).toBe("近7天没动静 · 上次 2026-06-10");

    expect(
      goalSummaryLines(
        overview({
          goal: goal({
            kind: "theme",
            members: [
              { kind: "task", id: "done-1" },
              { kind: "task", id: "done-2" },
            ],
          }),
          tasks: [
            task({ id: "done-1", done: true, completedAt: "2026-06-22T08:00:00.000Z" }),
            task({ id: "done-2", done: true, completedAt: "2026-06-21T08:00:00.000Z" }),
          ],
        }),
      ).completion,
    ).toBe("✓ 2 完成");
  });
});
