import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../test/dbReset.js";
import { getSetting, setSetting } from "../settings/index.js";
import {
  markGravityTasksSurfaced,
  parseGravitySurfacedMap,
  readGravitySurfacedMap,
  sanitizeGravitySurfacedMap,
  TODO_GRAVITY_REVIEW_SETTING_KEY,
} from "./gravityReviewStorage.ts";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("sanitizeGravitySurfacedMap", () => {
  it("returns empty object for null", () => {
    expect(sanitizeGravitySurfacedMap(null)).toEqual({});
  });

  it("returns empty object for arrays", () => {
    expect(sanitizeGravitySurfacedMap([1, 2, 3])).toEqual({});
  });

  it("drops entries with non-ISO values", () => {
    expect(
      sanitizeGravitySurfacedMap({
        ok: "2026-06-28T00:00:00.000Z",
        bad: "not-a-date",
        alsoBad: 42,
      }),
    ).toEqual({ ok: "2026-06-28T00:00:00.000Z" });
  });
});

describe("parseGravitySurfacedMap", () => {
  it("returns empty for null raw", () => {
    expect(parseGravitySurfacedMap(null)).toEqual({});
  });

  it("returns empty for malformed JSON", () => {
    expect(parseGravitySurfacedMap("{bad json")).toEqual({});
  });

  it("returns empty for JSON array", () => {
    expect(parseGravitySurfacedMap("[1,2,3]")).toEqual({});
  });

  it("parses valid object with ISO values", () => {
    const raw = JSON.stringify({ a: "2026-06-28T00:00:00.000Z", b: "2026-06-29T00:00:00.000Z" });
    expect(parseGravitySurfacedMap(raw)).toEqual({
      a: "2026-06-28T00:00:00.000Z",
      b: "2026-06-29T00:00:00.000Z",
    });
  });
});

describe("readGravitySurfacedMap", () => {
  it("returns empty when no settings row exists", async () => {
    expect(await readGravitySurfacedMap()).toEqual({});
  });

  it("reads back a stored map", async () => {
    await setSetting(TODO_GRAVITY_REVIEW_SETTING_KEY, JSON.stringify({ a: "2026-06-28T00:00:00.000Z" }));
    expect(await readGravitySurfacedMap()).toEqual({ a: "2026-06-28T00:00:00.000Z" });
  });
});

describe("markGravityTasksSurfaced", () => {
  it("writes settings JSON and creates a settings syncLog row", async () => {
    const now = new Date("2026-06-29T00:00:00.000Z");
    await markGravityTasksSurfaced(["a", "b"], now);

    const raw = await getSetting(TODO_GRAVITY_REVIEW_SETTING_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      a: "2026-06-29T00:00:00.000Z",
      b: "2026-06-29T00:00:00.000Z",
    });

    const logs = await db.syncLog.where("recordId").equals(TODO_GRAVITY_REVIEW_SETTING_KEY).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tableName: "settings",
      recordId: TODO_GRAVITY_REVIEW_SETTING_KEY,
      action: "create",
      synced: 0,
    });
  });

  it("merges with existing settings and keeps the later ISO for duplicate taskId", async () => {
    await setSetting(
      TODO_GRAVITY_REVIEW_SETTING_KEY,
      JSON.stringify({
        a: "2026-06-01T00:00:00.000Z",
        b: "2026-06-28T00:00:00.000Z",
      }),
    );

    const now = new Date("2026-06-29T00:00:00.000Z");
    await markGravityTasksSurfaced(["a", "c"], now);

    expect(await readGravitySurfacedMap()).toEqual({
      a: "2026-06-29T00:00:00.000Z", // merged: later ISO wins
      b: "2026-06-28T00:00:00.000Z", // untouched
      c: "2026-06-29T00:00:00.000Z", // new
    });
  });

  it("prunes entries older than max(90, waterlineDays * 4) days", async () => {
    await setSetting(
      TODO_GRAVITY_REVIEW_SETTING_KEY,
      JSON.stringify({
        old: "2025-01-01T00:00:00.000Z", // far too old
        recent: "2026-06-01T00:00:00.000Z", // within 90 days of now
      }),
    );

    const now = new Date("2026-06-29T00:00:00.000Z");
    await markGravityTasksSurfaced(["new"], now, { waterlineDays: 14 });

    expect(await readGravitySurfacedMap()).toEqual({
      recent: "2026-06-01T00:00:00.000Z",
      new: "2026-06-29T00:00:00.000Z",
    });
  });

  it("uses waterlineDays * 4 when larger than 90", async () => {
    // waterlineDays=50 → horizon=200 days
    const horizonDays = Math.max(90, 50 * 4); // 200
    const now = new Date("2026-06-29T00:00:00.000Z");
    const withinHorizon = new Date(now.getTime() - (horizonDays - 5) * 86400000).toISOString();
    const beyondHorizon = new Date(now.getTime() - (horizonDays + 5) * 86400000).toISOString();

    await setSetting(TODO_GRAVITY_REVIEW_SETTING_KEY, JSON.stringify({ keep: withinHorizon, drop: beyondHorizon }));

    await markGravityTasksSurfaced(["fresh"], now, { waterlineDays: 50 });

    const result = await readGravitySurfacedMap();
    expect(result.keep).toBe(withinHorizon);
    expect(result.drop).toBeUndefined();
    expect(result.fresh).toBe(now.toISOString());
  });

  it("records update (not create) action when settings row already exists", async () => {
    await setSetting(TODO_GRAVITY_REVIEW_SETTING_KEY, JSON.stringify({ existing: "2026-06-01T00:00:00.000Z" }));
    await db.syncLog.clear();

    await markGravityTasksSurfaced(["a"], new Date("2026-06-29T00:00:00.000Z"));

    const logs = await db.syncLog.where("recordId").equals(TODO_GRAVITY_REVIEW_SETTING_KEY).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "update" });
  });

  it("returns empty map for empty id list without writing", async () => {
    const result = await markGravityTasksSurfaced([], new Date("2026-06-29T00:00:00.000Z"));
    expect(result).toEqual({});
    expect(await getSetting(TODO_GRAVITY_REVIEW_SETTING_KEY)).toBeNull();
  });
});
