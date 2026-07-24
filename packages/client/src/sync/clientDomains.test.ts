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
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("taskNeedsApply", () => {
  it("existing 为空 -> 应用", () => {
    expect(__test.taskNeedsApply(undefined, task())).toBe(true);
  });

  it("schema 投影相等 -> 不应用（本地孤儿不触发）", () => {
    const existing = { ...task(), ghostField: "local-only" } as Task;

    expect(__test.taskNeedsApply(existing, task())).toBe(false);
  });

  it("任一字段差异 -> 应用（无需手列字段）", () => {
    expect(__test.taskNeedsApply(task({ tags: [] }), task({ tags: ["agent"] }))).toBe(true);
  });

  it("任一侧无法解析 -> 保守应用", () => {
    const existing = { ...task(), title: "" } as Task;

    expect(__test.taskNeedsApply(existing, task())).toBe(true);
  });

  it("detects parentId changes", () => {
    const existing = task({ id: "child-1", parentId: "root-a" });
    const remote = task({ id: "child-1", parentId: "root-b" });

    expect(__test.taskNeedsApply(existing, remote)).toBe(true);
  });

  it("treats task weight differences as a sync apply change", () => {
    const local = task({ id: "t1", weight: 0, updatedAt: "2026-06-28T01:00:00.000Z" });
    const remote = { ...local, weight: 2, updatedAt: "2026-06-28T02:00:00.000Z" };

    expect(__test.taskNeedsApply(local, remote)).toBe(true);
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

describe("goal client domain", () => {
  it("registers goals store with bundled backup", () => {
    expect(getClientDomain("goals")).toMatchObject({
      table: "goals",
      storeName: "goals",
      backup: "bundled",
    });
    expect(BACKUP_BUNDLED_DOMAINS.map((domain) => domain.table)).toContain("goals");
  });

  it("uses shared GoalSchema for goal payloads", () => {
    const now = "2026-06-22T01:00:00.000Z";
    expect(
      getClientDomain("goals").schema.safeParse({
        id: "goal-1",
        title: "发布 v2",
        kind: "theme",
        status: "active",
        prerequisites: [],
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);
  });
});

describe("goal layout pins client domain", () => {
  it("registers compound-key pins with bundled backup", () => {
    const domain = getClientDomain("goal_layout_pins");
    const pin = {
      goalId: "goal-1",
      nodeKind: "goal" as const,
      nodeId: "goal-1",
      x: 1,
      y: 2,
      updatedAt: "2026-06-24T00:00:00.000Z",
    };

    expect(domain).toMatchObject({
      table: "goal_layout_pins",
      storeName: "goalLayoutPins",
      backup: "bundled",
    });
    expect(domain.keyOf?.(pin)).toBe("goal-1|goal|goal-1");
    expect(BACKUP_BUNDLED_DOMAINS.map((item) => item.table)).toContain("goal_layout_pins");
  });
});

describe("sessions client domain", () => {
  it("registers sessions domain with bundled backup", () => {
    const domain = getClientDomain("sessions");
    expect(domain).toMatchObject({ table: "sessions", storeName: "sessions" });
    expect(BACKUP_BUNDLED_DOMAINS.map((item) => item.table)).toContain("sessions");
  });
});
