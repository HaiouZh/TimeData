import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
      "/diary",
      "/",
      "/todo",
      "/tracks",
      "/goals",
      "/stats/time",
      "/settings",
    ]);
    expect(new Set(MAIN_NAV_ROUTES).size).toBe(MAIN_NAV_ROUTES.length);
    expect(MAIN_NAV_ITEMS.map((item) => item.label)).toEqual([
      "记录",
      "日记",
      "时间轴",
      "待办",
      "轨道",
      "目标",
      "时间",
      "设置",
    ]);
  });

  it("uses the confirmed default icons", () => {
    expect(findMainNavItem("/quick-notes")?.iconName).toBe("NotePencil");
    expect(findMainNavItem("/diary")?.iconName).toBe("BookOpen");
    expect(findMainNavItem("/")?.iconName).toBe("Alarm");
    expect(findMainNavItem("/todo")?.iconName).toBe("ListChecks");
    expect(findMainNavItem("/tracks")?.iconName).toBe("Steps");
    expect(findMainNavItem("/goals")?.iconName).toBe("Planet");
    expect(findMainNavItem("/stats/time")?.iconName).toBe("ChartLine");
    expect(findMainNavItem("/settings")?.iconName).toBe("GearSix");
  });

  it("defaults every desktop entry to primary placement", () => {
    expect(DESKTOP_NAV_DEFAULT_ITEMS).toEqual(MAIN_NAV_ROUTES.map((to) => ({ to, placement: "primary" })));
  });

  it("does not expose module signature colors for navigation", () => {
    const retiredModuleMarker = "mo" + "d-";
    const retiredModuleColorField = "module" + "Color";
    for (const item of MAIN_NAV_ITEMS) {
      expect(item).not.toHaveProperty(retiredModuleColorField);
      expect(JSON.stringify(item)).not.toContain(retiredModuleMarker);
    }
  });

  it("normalizes legacy and detail paths to their primary route", () => {
    expect(primaryRouteForPath("/")).toBe("/");
    expect(primaryRouteForPath("/stats/todo")).toBe("/stats/time");
    expect(primaryRouteForPath("/entries/new")).toBe("/");
    expect(primaryRouteForPath("/entries/entry-1/edit")).toBe("/");
    expect(primaryRouteForPath("/tracks/track-1")).toBe("/tracks");
    expect(primaryRouteForPath("/goals/goal-1")).toBe("/goals");
    expect(primaryRouteForPath("/settings/nav")).toBe("/settings");
    expect(primaryRouteForPath("/stats")).toBe("/stats/time");
    expect(primaryRouteForPath("/diary/review")).toBe("/diary");
  });

  it("recognizes only configured main routes", () => {
    expect(isMainNavRoute("/todo")).toBe(true);
    expect(isMainNavRoute("/bogus")).toBe(false);
  });
});

// 主导航路由分散在 MAIN_NAV_ROUTES（isMainNavRoute 白名单）、MAIN_NAV_ITEMS（侧边栏/热键）与
// AppRoutes.tsx 的 <Route> 表三处。TypeScript 拦不住「白名单加了项却忘了注册路由」——MainNavRoute
// 只约束白名单外的路径，注册表是自由字符串。这里把 AppRoutes.tsx 当文本读、抽 path 值，断言
// MAIN_NAV_ROUTES 是已注册路由的子集；根路由当前写作 path="/"，故按 path 抽取即可覆盖。
const appRoutesPath = fileURLToPath(new URL("../../components/app-shell/AppRoutes.tsx", import.meta.url));
const appRoutesSource = readFileSync(appRoutesPath, "utf8");

const registeredPaths = new Set(
  [...appRoutesSource.matchAll(/\bpath="([^"]+)"/g)].map((match) => match[1]),
);

describe("主导航路由注册表", () => {
  it("MAIN_NAV_ROUTES 每一条都在 AppRoutes.tsx 注册了 <Route>", () => {
    const missing = MAIN_NAV_ROUTES.filter((route) => !registeredPaths.has(route));
    expect(missing).toEqual([]);
  });

  it("注册表里确实读到了主导航路由（防读取逻辑自身抽空）", () => {
    expect(registeredPaths.size).toBeGreaterThan(0);
  });
});
