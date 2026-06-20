import { describe, expect, it } from "vitest";
import { TaskSchema, type Task } from "@timedata/shared";
import { BACKUP_BUNDLED_DOMAINS, CLIENT_SYNC_DOMAINS, __test, getClientDomain } from "./clientDomains.js";

function task(overrides: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: "t1",
    parentId: null,
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,    completedCount: 0,
    turn: null,
    turnAt: null,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("taskNeedsApply", () => {
  it("detects parentId changes", () => {
    const existing = task({ id: "child-1", parentId: "root-a" });
    const remote = task({ id: "child-1", parentId: "root-b" });

    expect(__test.taskNeedsApply(existing, remote)).toBe(true);
  });
});

describe("track client domains", () => {
  it("registers tracks and track_steps stores with bundled backup", () => {
    expect(Object.keys(CLIENT_SYNC_DOMAINS)).toEqual(
      expect.arrayContaining(["tracks", "track_steps"]),
    );
    expect(getClientDomain("tracks")).toMatchObject({
      table: "tracks",
      storeName: "tracks",
      backup: "bundled",
    });
    expect(getClientDomain("track_steps")).toMatchObject({
      table: "track_steps",
      storeName: "trackSteps",
      backup: "bundled",
    });
    expect(BACKUP_BUNDLED_DOMAINS.map((domain) => domain.table)).toEqual(
      expect.arrayContaining(["tracks", "track_steps"]),
    );
  });

  it("uses shared schemas for track payloads", () => {
    const now = "2026-06-21T00:00:00.000Z";
    expect(
      getClientDomain("tracks").schema.safeParse({
        id: "track-1",
        title: "T1",
        status: "active",
        refs: [],
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);
    expect(
      getClientDomain("track_steps").schema.safeParse({
        id: "step-1",
        trackId: "track-1",
        source: "agent",
        content: "",
        startedAt: now,
        endedAt: null,
        refs: [],
        tags: [],
        seq: 0,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);
  });
});
