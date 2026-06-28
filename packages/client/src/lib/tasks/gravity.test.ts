import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import {
  DEFAULT_TODO_GRAVITY_SETTINGS,
  isTaskSunken,
  pickGravityReviewBatch,
  splitInboxByGravity,
  type GravitySurfacedMap,
} from "./gravity.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    parentId: null,
    title: overrides.title ?? "想法",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    weight: 0,
    createdAt: overrides.createdAt ?? "2026-05-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("todo gravity", () => {
  const now = new Date("2026-06-28T00:00:00.000Z");
  const settings = DEFAULT_TODO_GRAVITY_SETTINGS;

  it("keeps new tasks visible during grace period", () => {
    expect(isTaskSunken(task({ createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" }), settings, now)).toBe(false);
  });

  it("sinks stale inbox tasks when weight cannot offset age", () => {
    expect(isTaskSunken(task({ updatedAt: "2026-06-01T00:00:00.000Z", weight: 1 }), settings, now)).toBe(true);
  });

  it("keeps weighted tasks afloat until age exceeds effective stale days", () => {
    expect(isTaskSunken(task({ updatedAt: "2026-06-08T00:00:00.000Z", weight: 1 }), settings, now)).toBe(false);
  });

  it("splits inbox into floating and sunken lists without reordering", () => {
    const fresh = task({ id: "fresh", updatedAt: "2026-06-24T00:00:00.000Z" });
    const stale = task({ id: "stale", updatedAt: "2026-06-01T00:00:00.000Z" });

    expect(splitInboxByGravity([fresh, stale], settings, now)).toEqual({
      floating: [fresh],
      sunken: [stale],
    });
  });

  it("prioritizes never surfaced items before older surfaced items", () => {
    const surfaced: GravitySurfacedMap = { old: "2026-06-20T00:00:00.000Z" };
    const batch = pickGravityReviewBatch(
      [task({ id: "old" }), task({ id: "never" })],
      surfaced,
      { now, drawM: 2 },
    );

    expect(batch.map((item) => item.id)).toEqual(["never", "old"]);
  });

  it("uses weight as a mild tiebreaker for surfaced review cards", () => {
    const surfaced: GravitySurfacedMap = {
      low: "2026-06-20T00:00:00.000Z",
      high: "2026-06-20T00:00:00.000Z",
    };
    const batch = pickGravityReviewBatch(
      [
        task({ id: "low", createdAt: "2026-05-01T00:00:00.000Z", weight: 0 }),
        task({ id: "high", createdAt: "2026-05-02T00:00:00.000Z", weight: 3 }),
      ],
      surfaced,
      { now, drawM: 2 },
    );

    expect(batch.map((item) => item.id)).toEqual(["high", "low"]);
  });
});
