// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import {
  DEFAULT_ACTION_TAGS,
  LEGACY_TRACK_ACTION_TAGS_KEY,
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
    expect(sanitizeActionTags([" 待我处理 ", "待我处理", "", 3, "agent在做"])).toEqual(["待我处理", "agent在做"]);
    expect(sanitizeActionTags(["ok", "x".repeat(65)])).toEqual(["ok"]);
    expect(sanitizeActionTags("nope")).toEqual([]);
    expect(sanitizeActionTags(null)).toEqual([]);
  });

  it("defaults to the two board signal tags when never configured", async () => {
    await expect(readTrackActionTags()).resolves.toEqual(["待我处理", "agent在做"]);
  });

  it("round-trips set tags and respects an explicit empty list", async () => {
    await setTrackActionTags([" 待我处理 ", "待我处理", "agent在做"]);
    expect(await readTrackActionTags()).toEqual(["待我处理", "agent在做"]);
    await setTrackActionTags([]);
    expect(await readTrackActionTags()).toEqual([]);
  });

  it("falls back to the seed for corrupt JSON or non-array values", async () => {
    const now = new Date().toISOString();
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: "{bad json", updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify({ tags: ["待我处理"] }), updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify([42, "", "   "]), updatedAt: now });
    expect(await readTrackActionTags()).toEqual([...DEFAULT_ACTION_TAGS]);
  });

  it("writes a synced settings log on save", async () => {
    await setTrackActionTags(["待我处理", "复盘"]);
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: TRACK_ACTION_TAGS_KEY, action: "create", synced: 0 },
    ]);
  });

  it("treats the old default v2 court configs as unset and returns the new default signals", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify([
        { tag: "等我", court: "mine" },
        { tag: "待决策", court: "mine" },
        { tag: "卡住", court: "blocked" },
        { tag: "agent在做", court: "agent" },
      ]),
      updatedAt: now,
    });

    await expect(readTrackActionTags()).resolves.toEqual(["待我处理", "agent在做"]);
  });

  it("reads customized legacy v2 configs by tag text and ignores courts", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify([
        { tag: "需我确认", court: "mine" },
        { tag: "agent在做", court: "agent" },
        { tag: "需我确认", court: "blocked" },
        { tag: "", court: "agent" },
      ]),
      updatedAt: now,
    });

    await expect(readTrackActionTags()).resolves.toEqual(["需我确认", "agent在做"]);
  });

  it("reads legacy v1 strings without writing v2 and normalizes the old default set", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: LEGACY_TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify(["等我", "待决策", "卡住", "agent在做"]),
      updatedAt: now,
    });

    await expect(readTrackActionTags()).resolves.toEqual(["待我处理", "agent在做"]);
    await expect(db.settings.get(TRACK_ACTION_TAGS_KEY)).resolves.toBeUndefined();
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
  });

  it("keeps customized legacy v1 strings as board signals", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: LEGACY_TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify(["需我确认", "agent在做"]),
      updatedAt: now,
    });

    await expect(readTrackActionTags()).resolves.toEqual(["需我确认", "agent在做"]);
    await expect(db.settings.get(TRACK_ACTION_TAGS_KEY)).resolves.toBeUndefined();
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
  });

  it("writes a synced v2 string array on explicit save", async () => {
    await setTrackActionTags([" 待我处理 ", "待我处理", "agent在做"]);
    await expect(db.settings.get(TRACK_ACTION_TAGS_KEY)).resolves.toMatchObject({
      key: "track.actionTags.v2",
      value: JSON.stringify(["待我处理", "agent在做"]),
    });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: TRACK_ACTION_TAGS_KEY, action: "create", synced: 0 },
    ]);
  });

  it("reads a legacy v2 string array directly", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify(["需我确认", "agent在做"]),
      updatedAt: now,
    });

    await expect(readTrackActionTags()).resolves.toEqual(["需我确认", "agent在做"]);
  });

  it("respects explicit empty v2", async () => {
    await setTrackActionTags([]);
    await expect(readTrackActionTags()).resolves.toEqual([]);
  });

  it("falls back to seed tags for corrupt non-empty v2", async () => {
    const now = new Date().toISOString();
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: "{bad json", updatedAt: now });
    await expect(readTrackActionTags()).resolves.toEqual([...DEFAULT_ACTION_TAGS]);

    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify([42, "", "   "]), updatedAt: now });
    await expect(readTrackActionTags()).resolves.toEqual([...DEFAULT_ACTION_TAGS]);
  });
});
