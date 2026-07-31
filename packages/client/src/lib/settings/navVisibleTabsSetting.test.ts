import { beforeEach, describe, expect, it } from "vitest";
import { MAIN_NAV_ITEMS } from "../navigation/navRegistry.js";
import { db, resetDb } from "../../test/dbReset.js";
import {
  CONFIGURABLE_TABS,
  NAV_VISIBLE_TABS_KEY,
  readTabOrder,
  readVisibleTabs,
  sanitizeTabOrder,
  setTabOrder,
} from "./navVisibleTabsSetting.js";

beforeEach(resetDb);

describe("navVisibleTabsSetting", () => {
  it("defaults to all configurable tabs visible when unset", async () => {
    await expect(readTabOrder()).resolves.toEqual(CONFIGURABLE_TABS.map((to) => ({ to, hidden: false })));
    await expect(readVisibleTabs()).resolves.toEqual([...CONFIGURABLE_TABS]);
  });

  it("sanitizes new-format arrays preserving user order and filling missing as hidden", () => {
    expect(
      sanitizeTabOrder([
        { to: "/todo", hidden: false },
        { to: "/", hidden: true },
      ]),
    ).toEqual([
      { to: "/quick-notes", hidden: true },
      { to: "/diary", hidden: true },
      { to: "/todo", hidden: false },
      { to: "/", hidden: true },
      { to: "/tracks", hidden: true },
      { to: "/goals", hidden: true },
      { to: "/stats/time", hidden: true },
    ]);
  });

  it("migrates legacy string arrays, marking missing tabs hidden at canonical positions", () => {
    expect(sanitizeTabOrder(["/", "/todo"])).toEqual([
      { to: "/quick-notes", hidden: true },
      { to: "/diary", hidden: true },
      { to: "/", hidden: false },
      { to: "/todo", hidden: false },
      { to: "/tracks", hidden: true },
      { to: "/goals", hidden: true },
      { to: "/stats/time", hidden: true },
    ]);
  });

  it("maps legacy /stats to /stats/time and dedups", () => {
    expect(sanitizeTabOrder(["/", "/stats", "/stats/time"])).toEqual([
      { to: "/quick-notes", hidden: true },
      { to: "/diary", hidden: true },
      { to: "/", hidden: false },
      { to: "/todo", hidden: true },
      { to: "/tracks", hidden: true },
      { to: "/goals", hidden: true },
      { to: "/stats/time", hidden: false },
    ]);
  });

  it("keeps legacy empty arrays as all-hidden", () => {
    expect(sanitizeTabOrder([])).toEqual(CONFIGURABLE_TABS.map((to) => ({ to, hidden: true })));
  });

  it("falls back to all-visible defaults for corrupt values", () => {
    expect(sanitizeTabOrder(null)).toEqual(CONFIGURABLE_TABS.map((to) => ({ to, hidden: false })));
    expect(sanitizeTabOrder("nope")).toEqual(CONFIGURABLE_TABS.map((to) => ({ to, hidden: false })));
  });

  it("persists order and hidden flags and writes a settings syncLog", async () => {
    await setTabOrder([
      { to: "/", hidden: false },
      { to: "/todo", hidden: true },
    ]);

    await expect(readTabOrder()).resolves.toEqual([
      { to: "/quick-notes", hidden: true },
      { to: "/diary", hidden: true },
      { to: "/", hidden: false },
      { to: "/todo", hidden: true },
      { to: "/tracks", hidden: true },
      { to: "/goals", hidden: true },
      { to: "/stats/time", hidden: true },
    ]);
    const logs = await db.syncLog.where("recordId").equals(NAV_VISIBLE_TABS_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });

  it("derives visible tabs from the order", async () => {
    await setTabOrder([
      { to: "/quick-notes", hidden: false },
      { to: "/todo", hidden: true },
      { to: "/", hidden: false },
    ]);

    await expect(readVisibleTabs()).resolves.toEqual(["/quick-notes", "/"]);
  });

  // 真闸：新增一级导航却忘了登记到 CONFIGURABLE_TABS，该模块会在手机底栏与
  // 「设置 · 导航」勾选列表里彻底消失（/diary 就这么漏过一次）。
  it("covers every main nav route except the always-visible /settings", () => {
    const expected = MAIN_NAV_ITEMS.map((item) => item.to).filter((to) => to !== "/settings");
    expect([...CONFIGURABLE_TABS]).toEqual(expected);
  });
});