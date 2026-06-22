// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import {
  DEFAULT_ACTION_TAG_CONFIGS,
  DEFAULT_ACTION_TAGS,
  LEGACY_TRACK_ACTION_TAGS_KEY,
  readTrackActionTagConfigs,
  readTrackActionTags,
  sanitizeActionTagConfigs,
  sanitizeActionTags,
  setTrackActionTagConfigs,
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

  it("defaults to v2 seed configs with fixed courts", async () => {
    await expect(readTrackActionTagConfigs()).resolves.toEqual([
      { tag: "等我", court: "mine" },
      { tag: "待决策", court: "mine" },
      { tag: "卡住", court: "blocked" },
      { tag: "agent在做", court: "agent" },
    ]);
    await expect(readTrackActionTags()).resolves.toEqual(["等我", "待决策", "卡住", "agent在做"]);
  });

  it("shadow-migrates legacy v1 strings without writing v2 during read", async () => {
    const now = new Date().toISOString();
    await db.settings.put({
      key: LEGACY_TRACK_ACTION_TAGS_KEY,
      value: JSON.stringify(["等我", "复盘", "agent在做"]),
      updatedAt: now,
    });

    await expect(readTrackActionTagConfigs()).resolves.toEqual([
      { tag: "等我", court: "mine" },
      { tag: "复盘", court: "neutral" },
      { tag: "agent在做", court: "agent" },
    ]);
    await expect(db.settings.get(TRACK_ACTION_TAGS_KEY)).resolves.toBeUndefined();
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
  });

  it("writes v2 and syncLog only on explicit save", async () => {
    await setTrackActionTagConfigs([{ tag: "等我", court: "mine" }]);
    await expect(db.settings.get(TRACK_ACTION_TAGS_KEY)).resolves.toMatchObject({
      key: "track.actionTags.v2",
      value: JSON.stringify([{ tag: "等我", court: "mine" }]),
    });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: TRACK_ACTION_TAGS_KEY, action: "create", synced: 0 },
    ]);
  });

  it("sanitizes invalid courts to neutral and respects explicit empty v2", async () => {
    expect(
      sanitizeActionTagConfigs([
        { tag: " 等我 ", court: "mine" },
        { tag: "等我", court: "agent" },
        { tag: "怪标签", court: "bogus" },
        { tag: "", court: "mine" },
        "plain string",
      ]),
    ).toEqual([
      { tag: "等我", court: "mine" },
      { tag: "怪标签", court: "neutral" },
    ]);

    await setTrackActionTagConfigs([]);
    await expect(readTrackActionTagConfigs()).resolves.toEqual([]);
  });

  it("falls back to seed configs for corrupt non-empty v2", async () => {
    const now = new Date().toISOString();
    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: "{bad json", updatedAt: now });
    await expect(readTrackActionTagConfigs()).resolves.toEqual([...DEFAULT_ACTION_TAG_CONFIGS]);

    await db.settings.put({ key: TRACK_ACTION_TAGS_KEY, value: JSON.stringify([42, "", "   "]), updatedAt: now });
    await expect(readTrackActionTagConfigs()).resolves.toEqual([...DEFAULT_ACTION_TAG_CONFIGS]);
  });
});
