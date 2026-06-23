import { describe, expect, it } from "vitest";
import {
  DESKTOP_NAV_DEFAULT_ITEMS,
  MAIN_NAV_ITEMS,
  MAIN_NAV_ROUTES,
  findMainNavItem,
  isMainNavRoute,
  primaryRouteForPath,
} from "./navRegistry.js";

describe("navRegistry", () => {
  it("keeps every route unique and includes the confirmed main entries", () => {
    expect(MAIN_NAV_ROUTES).toEqual([
      "/quick-notes",
      "/",
      "/todo",
      "/tracks",
      "/goals",
      "/stats/time",
      "/stats/health",
      "/settings",
    ]);
    expect(new Set(MAIN_NAV_ROUTES).size).toBe(MAIN_NAV_ROUTES.length);
    expect(MAIN_NAV_ITEMS.map((item) => item.label)).toEqual([
      "记录",
      "时间轴",
      "待办",
      "轨道",
      "目标",
      "时间",
      "健康",
      "设置",
    ]);
  });

  it("uses the confirmed default icons", () => {
    expect(findMainNavItem("/quick-notes")?.iconName).toBe("Notebook");
    expect(findMainNavItem("/")?.iconName).toBe("Alarm");
    expect(findMainNavItem("/todo")?.iconName).toBe("ListChecks");
    expect(findMainNavItem("/tracks")?.iconName).toBe("Steps");
    expect(findMainNavItem("/goals")?.iconName).toBe("Planet");
    expect(findMainNavItem("/stats/time")?.iconName).toBe("ChartLine");
    expect(findMainNavItem("/stats/health")?.iconName).toBe("Heartbeat");
    expect(findMainNavItem("/settings")?.iconName).toBe("GearSix");
  });

  it("defaults every desktop entry to primary placement", () => {
    expect(DESKTOP_NAV_DEFAULT_ITEMS).toEqual(MAIN_NAV_ROUTES.map((to) => ({ to, placement: "primary" })));
  });

  it("normalizes legacy and detail paths to their primary route", () => {
    expect(primaryRouteForPath("/")).toBe("/");
    expect(primaryRouteForPath("/entries/new")).toBe("/");
    expect(primaryRouteForPath("/entries/entry-1/edit")).toBe("/");
    expect(primaryRouteForPath("/tracks/track-1")).toBe("/tracks");
    expect(primaryRouteForPath("/goals/goal-1")).toBe("/goals");
    expect(primaryRouteForPath("/settings/nav")).toBe("/settings");
    expect(primaryRouteForPath("/stats")).toBe("/stats/time");
    expect(primaryRouteForPath("/stats/health")).toBe("/stats/health");
  });

  it("recognizes only configured main routes", () => {
    expect(isMainNavRoute("/todo")).toBe(true);
    expect(isMainNavRoute("/bogus")).toBe(false);
  });
});
