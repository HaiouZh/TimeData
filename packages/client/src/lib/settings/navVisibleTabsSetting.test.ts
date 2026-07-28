import { beforeEach, describe, expect, it } from "vitest";
import { MAIN_NAV_ITEMS } from "../navigation/navRegistry.js";
import { db, resetDb } from "../../test/dbReset.js";
import {
  CONFIGURABLE_TABS,
  NAV_VISIBLE_TABS_KEY,
  readVisibleTabs,
  sanitizeVisibleTabs,
  setVisibleTabs,
} from "./navVisibleTabsSetting.js";

beforeEach(resetDb);

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

  // 真闸：新增一级导航却忘了登记到 CONFIGURABLE_TABS，该模块会在手机底栏与
  // 「设置 · 导航」勾选列表里彻底消失（/diary 就这么漏过一次）。
  it("covers every main nav route except the always-visible /settings", () => {
    const expected = MAIN_NAV_ITEMS.map((item) => item.to).filter((to) => to !== "/settings");
    expect([...CONFIGURABLE_TABS]).toEqual(expected);
  });

  it("includes tracks as a default-visible configurable tab", async () => {
    await expect(readVisibleTabs()).resolves.toEqual([
      "/quick-notes",
      "/diary",
      "/",
      "/todo",
      "/tracks",
      "/goals",
      "/stats/time",
      "/stats/health",
    ]);
    expect(sanitizeVisibleTabs(["/tracks", "/goals", "/bogus", "/tracks"])).toEqual(["/tracks", "/goals"]);
  });
});
