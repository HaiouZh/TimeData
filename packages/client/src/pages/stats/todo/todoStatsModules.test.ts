import { describe, expect, it } from "vitest";
import { TODO_STATS_MODULE_LIST, TODO_STATS_MODULES } from "./todoStatsModules.ts";

const EXPECTED_IDS = [
  "overview",
  "created",
  "completed",
  "age",
  "heatmap",
  "cycle",
  "rhythm",
  "dimension",
  "deleted",
] as const;

describe("TODO_STATS_MODULES", () => {
  it("期2 注册 9 个模块（含 deleted），且顺序与 spec 编号一致", () => {
    expect(TODO_STATS_MODULE_LIST.map((module) => module.id)).toEqual([...EXPECTED_IDS]);
    expect(Object.keys(TODO_STATS_MODULES).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("每个模块默认可见、有标题与说明", () => {
    for (const module of TODO_STATS_MODULE_LIST) {
      expect(module.defaultVisible).toBe(true);
      expect(module.title.length).toBeGreaterThan(0);
      expect(module.description.length).toBeGreaterThan(0);
    }
  });
});
