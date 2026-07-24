import { describe, expect, it } from "vitest";
import { SYNC_DOMAINS, SYNC_TABLE_NAMES, buildSyncChangeSchema, getSyncDomain } from "./syncDomains.js";
import { UtcIsoStringSchema } from "./entitySchemas.js";

describe("sync domain registry", () => {
  it("registers the domains in order priority", () => {
    expect(SYNC_TABLE_NAMES).toEqual([
      "categories",
      "time_entries",
      "settings",
      "quick_notes",
      "tasks",
      "health_heart_rate",
      "health_hrv",
      "health_sleep",
      "health_stress",
      "runs",
      "health_charts",
      "tracks",
      "track_steps",
      "goals",
      "goal_layout_pins",
      "sessions",
    ]);
  });

  it("declares conflict policy per domain", () => {
    expect(getSyncDomain("time_entries").conflictPolicy).toBe("manual");
    expect(getSyncDomain("quick_notes").conflictPolicy).toBe("lww");
    expect(getSyncDomain("settings").conflictPolicy).toBe("lww");
    expect(getSyncDomain("categories").conflictPolicy).toBe("manual");
  });

  it("orders upserts before deletes across domains", () => {
    const cats = getSyncDomain("categories");
    expect(cats.upsertPriority).toBeLessThan(getSyncDomain("time_entries").upsertPriority);
    expect(cats.deletePriority).toBeGreaterThan(getSyncDomain("quick_notes").upsertPriority);
  });

  it("throws on unknown domain", () => {
    expect(() => getSyncDomain("nope")).toThrow(/Unknown sync domain/);
  });

  it("every domain has a data schema", () => {
    for (const domain of SYNC_DOMAINS) {
      expect(domain.dataSchema.safeParse(null).success).toBe(false);
    }
  });

  it("registers health_charts as lww domain", () => {
    const domain = SYNC_DOMAINS.find((d) => d.table === "health_charts");
    expect(domain).toBeDefined();
    expect(domain?.conflictPolicy).toBe("lww");
  });
});

describe("track domain registration", () => {
  it("registers tracks and track_steps with dependency-safe priorities", () => {
    const tracks = getSyncDomain("tracks");
    const steps = getSyncDomain("track_steps");

    expect(tracks.conflictPolicy).toBe("lww");
    expect(steps.conflictPolicy).toBe("lww");
    expect(tracks.countsInStatus).toBe(false);
    expect(steps.countsInStatus).toBe(false);
    expect(steps.upsertPriority).toBeGreaterThan(tracks.upsertPriority);
    expect(steps.deletePriority).toBeLessThan(tracks.deletePriority);
  });

  it("buildSyncChangeSchema accepts track and step changes", () => {
    const schema = buildSyncChangeSchema(UtcIsoStringSchema);
    const now = "2026-06-21T00:00:00.000Z";
    expect(
      schema.safeParse({
        tableName: "tracks",
        recordId: "track-1",
        action: "create",
        timestamp: now,
        data: { id: "track-1", title: "T1", status: "active", refs: [], createdAt: now, updatedAt: now },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        tableName: "track_steps",
        recordId: "step-1",
        action: "create",
        timestamp: now,
        data: {
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
        },
      }).success,
    ).toBe(true);
  });
});

describe("goals domain registration", () => {
  it("registers goals as an lww domain after track steps", () => {
    const goals = getSyncDomain("goals");
    const trackSteps = getSyncDomain("track_steps");
    expect(goals.conflictPolicy).toBe("lww");
    expect(goals.countsInStatus).toBe(false);
    expect(goals.upsertPriority).toBeGreaterThan(trackSteps.upsertPriority);
    expect(goals.deletePriority).toBeGreaterThan(getSyncDomain("tracks").deletePriority);
    expect(SYNC_TABLE_NAMES).toContain("goals");
  });
});

describe("goal layout pin domain registration", () => {
  it("registers goal_layout_pins as an lww domain after goals", () => {
    const pins = getSyncDomain("goal_layout_pins");
    const goals = getSyncDomain("goals");

    expect(pins.conflictPolicy).toBe("lww");
    expect(pins.countsInStatus).toBe(false);
    expect(pins.upsertPriority).toBeGreaterThan(goals.upsertPriority);
    expect(pins.deletePriority).toBeGreaterThanOrEqual(goals.deletePriority);
    expect(SYNC_TABLE_NAMES).toContain("goal_layout_pins");
  });
});

describe("sessions domain registration", () => {
  it("registers sessions as an lww domain after goal_layout_pins", () => {
    const sessions = getSyncDomain("sessions");
    expect(sessions.conflictPolicy).toBe("lww");
    expect(sessions.countsInStatus).toBe(false);
    expect(SYNC_TABLE_NAMES).toContain("sessions");
  });
});

describe("tasks domain registration", () => {
  it("is registered as an lww domain not counted in status", () => {
    const tasks = SYNC_DOMAINS.find((d) => d.table === "tasks");
    expect(tasks).toBeDefined();
    expect(tasks?.conflictPolicy).toBe("lww");
    expect(tasks?.countsInStatus).toBe(false);
    expect(SYNC_TABLE_NAMES).toContain("tasks");
  });
  it("buildSyncChangeSchema accepts a tasks create", () => {
    const schema = buildSyncChangeSchema(UtcIsoStringSchema);
    const ok = schema.safeParse({
      tableName: "tasks", action: "create", recordId: "t1", timestamp: "2026-06-14T00:00:00.000Z",
      data: { id: "t1", title: "x", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: null, sortOrder: 0, createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z" },
    });
    expect(ok.success).toBe(true);
  });
});
