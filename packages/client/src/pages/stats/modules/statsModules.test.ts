import { describe, expect, it } from "vitest";
import { STATS_MODULES, STATS_MODULE_LIST } from "./statsModules.ts";
import { STATS_MODULE_IDS } from "./types.ts";

describe("STATS_MODULES", () => {
  it("覆盖全部 StatsModuleId 且无多余", () => {
    expect(Object.keys(STATS_MODULES).sort()).toEqual([...STATS_MODULE_IDS].sort());
  });

  it("每个模块有标题与说明", () => {
    for (const module of STATS_MODULE_LIST) {
      expect(module.title.length).toBeGreaterThan(0);
      expect(module.description.length).toBeGreaterThan(0);
    }
  });
});
