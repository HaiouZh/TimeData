// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import {
  DEFAULT_ACTION_TAGS,
  readTrackActionTags,
  sanitizeActionTags,
  setTrackActionTags,
  TRACK_ACTION_TAGS_KEY,
} from "./trackActionTagsSetting.js";

beforeEach(async () => {
  await db.open();
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("trackActionTagsSetting", () => {
  it("sanitizeActionTags trims, drops empties/non-strings/overlong, and dedupes", () => {
    expect(sanitizeActionTags([" 等我 ", "等我", "", 3, "卡住"])).toEqual(["等我", "卡住"]);
    expect(sanitizeActionTags(["ok", "x".repeat(65)])).toEqual(["ok"]);
    expect(sanitizeActionTags("nope")).toEqual([]);
    expect(sanitizeActionTags(null)).toEqual([]);
  });

  it("defaults to the seed tags when never configured", async () => {
    expect(await readTrackActionTags()).toEqual(["等我", "待决策", "卡住", "agent在做"]);
  });

  it("round-trips set tags and respects an explicit empty list", async () => {
    await setTrackActionTags([" 待决策 ", "待决策", "等我"]);
    expect(await readTrackActionTags()).toEqual(["待决策", "等我"]);
    await setTrackActionTags([]);
    expect(await readTrackActionTags()).toEqual([]);
  });

  it("falls back to the seed for corrupt JSON or non-array values", async () => {
    const now = new Date().toISOString();
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: "{bad json", updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify({ tags: ["等我"] }), updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify([42, "", "   "]), updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
  });

  it("writes a synced settings log on save", async () => {
    await setTrackActionTags(["等我", "复盘"]);
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: TRACK_ACTION_TAGS_KEY, action: "create", synced: 0 },
    ]);
  });
});
