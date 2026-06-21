import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import {
  CONFIGURABLE_TABS,
  NAV_VISIBLE_TABS_KEY,
  readVisibleTabs,
  sanitizeVisibleTabs,
  setVisibleTabs,
} from "./navVisibleTabsSetting.js";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("navVisibleTabsSetting", () => {
  it("defaults to all configurable tabs when unset", async () => {
    await expect(readVisibleTabs()).resolves.toEqual([...CONFIGURABLE_TABS]);
  });

  it("sanitize drops unknown tabs and dedups", () => {
    expect(sanitizeVisibleTabs(["/", "/bogus", "/"])).toEqual(["/"]);
  });

  it("keeps time and health stats as separate tabs", () => {
    expect(sanitizeVisibleTabs(["/quick-notes", "/stats/time", "/stats/health"])).toEqual([
      "/quick-notes",
      "/stats/time",
      "/stats/health",
    ]);
  });

  it("maps legacy /stats to /stats/time", () => {
    expect(sanitizeVisibleTabs(["/", "/stats", "/todo"])).toEqual(["/", "/todo", "/stats/time"]);
  });

  it("deduplicates legacy and new stats tabs", () => {
    expect(sanitizeVisibleTabs(["/stats", "/stats/time", "/stats/health"])).toEqual(["/stats/time", "/stats/health"]);
  });

  it("persists selection and writes a settings syncLog", async () => {
    await setVisibleTabs(["/", "/todo"]);

    await expect(readVisibleTabs()).resolves.toEqual(["/", "/todo"]);
    const logs = await db.syncLog.where("recordId").equals(NAV_VISIBLE_TABS_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });

  it("allows hiding every configurable tab", async () => {
    await setVisibleTabs([]);

    await expect(readVisibleTabs()).resolves.toEqual([]);
  });

  it("includes tracks as a default-visible configurable tab", async () => {
    await expect(readVisibleTabs()).resolves.toEqual([
      "/quick-notes",
      "/",
      "/todo",
      "/tracks",
      "/stats/time",
      "/stats/health",
    ]);
    expect(sanitizeVisibleTabs(["/tracks", "/bogus", "/tracks"])).toEqual(["/tracks"]);
  });
});
