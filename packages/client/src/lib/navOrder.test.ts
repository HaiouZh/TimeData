import { describe, expect, it } from "vitest";
import { insertTabAtCanonicalPosition, reorderTabs } from "./navOrder.js";
import { CONFIGURABLE_TABS } from "./settings/navVisibleTabsSetting.js";

describe("reorderTabs", () => {
  it("moves an item forward", () => {
    expect(reorderTabs(["/", "/todo", "/tracks"], "/todo", "/tracks")).toEqual(["/", "/tracks", "/todo"]);
  });

  it("moves an item backward", () => {
    expect(reorderTabs(["/", "/todo", "/tracks"], "/tracks", "/")).toEqual(["/tracks", "/", "/todo"]);
  });

  it("returns a copy when ids are equal", () => {
    const tabs = ["/", "/todo"];
    expect(reorderTabs(tabs, "/todo", "/todo")).toEqual(tabs);
  });

  it("returns the input order for unknown ids", () => {
    expect(reorderTabs(["/", "/todo"], "/bogus", "/todo")).toEqual(["/", "/todo"]);
    expect(reorderTabs(["/", "/todo"], "/todo", "/bogus")).toEqual(["/", "/todo"]);
  });
});

describe("insertTabAtCanonicalPosition", () => {
  it("inserts at the beginning when canonical position is first", () => {
    // CONFIGURABLE_TABS 规范序：/quick-notes, /diary, /, /todo, /tracks, /goals, /stats/time
    expect(insertTabAtCanonicalPosition(["/todo", "/tracks"], "/quick-notes")).toEqual([
      "/quick-notes",
      "/todo",
      "/tracks",
    ]);
  });

  it("inserts in the middle by canonical order", () => {
    expect(insertTabAtCanonicalPosition(["/quick-notes", "/tracks"], "/todo")).toEqual([
      "/quick-notes",
      "/todo",
      "/tracks",
    ]);
  });

  it("appends when canonical position is after all visible", () => {
    expect(insertTabAtCanonicalPosition(["/quick-notes", "/todo"], "/stats/time")).toEqual([
      "/quick-notes",
      "/todo",
      "/stats/time",
    ]);
  });

  it("returns a copy when the tab is already visible", () => {
    const visible = ["/todo"];
    expect(insertTabAtCanonicalPosition(visible, "/todo")).toEqual(visible);
  });
});

// 真闸：规范位推导依赖 CONFIGURABLE_TABS 顺序，漂移会让「重开回规范位」错位。
it("canonical order used by insertTabAtCanonicalPosition matches CONFIGURABLE_TABS", () => {
  expect(CONFIGURABLE_TABS).toEqual([
    "/quick-notes",
    "/diary",
    "/",
    "/todo",
    "/tracks",
    "/goals",
    "/stats/time",
  ]);
});