import { describe, expect, it } from "vitest";
import { SYNC_DOMAINS, SYNC_TABLE_NAMES, getSyncDomain } from "./syncDomains.js";

describe("sync domain registry", () => {
  it("registers the domains in order priority", () => {
    expect(SYNC_TABLE_NAMES).toEqual([
      "categories",
      "time_entries",
      "settings",
      "quick_notes",
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
