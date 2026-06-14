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
      data: { id: "t1", title: "x", done: false, recurrence: null, lastDoneAt: null, startAt: null, sortOrder: 0, createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z" },
    });
    expect(ok.success).toBe(true);
  });
});
