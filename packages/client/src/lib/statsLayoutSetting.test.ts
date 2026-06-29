import { beforeEach, describe, expect, it } from "vitest";
import type { StatsModuleDescriptor } from "../pages/stats/modules/types.ts";
import { resetDb } from "../test/dbReset.js";
import { setSetting } from "./settings/index.ts";
import { DEFAULT_STATS_LAYOUT, getStatsLayout, sanitizeStatsLayout } from "./statsLayoutSetting.ts";

const MODS: StatsModuleDescriptor[] = [
  { id: "overview", defaultVisible: true },
  { id: "routine", defaultVisible: true },
  { id: "anomalies", defaultVisible: true },
  { id: "trend", defaultVisible: true },
  { id: "structure", defaultVisible: true },
];

beforeEach(resetDb);

describe("sanitizeStatsLayout", () => {
  it("null 输入回退默认布局", () => {
    expect(sanitizeStatsLayout(null, MODS)).toEqual(DEFAULT_STATS_LAYOUT(MODS));
  });

  it("剔除未知 id", () => {
    const out = sanitizeStatsLayout({ order: ["overview", "ghost", "routine"], hidden: ["ghost"] }, MODS);
    expect(out.order).not.toContain("ghost");
    expect(out.hidden).not.toContain("ghost");
  });

  it("把缺失的已注册模块按默认可见性追加到末尾", () => {
    const out = sanitizeStatsLayout({ order: ["overview"], hidden: [] }, MODS);
    expect(out.order).toEqual(["overview", "routine", "anomalies", "trend", "structure"]);
  });

  it("去重", () => {
    const out = sanitizeStatsLayout({ order: ["overview", "overview", "routine"], hidden: [] }, MODS);
    expect(out.order.filter((id) => id === "overview")).toHaveLength(1);
  });

  it("defaultVisible=false 的新增模块补进 hidden", () => {
    const mods: StatsModuleDescriptor[] = [...MODS, { id: "focus" as never, defaultVisible: false }];
    const out = sanitizeStatsLayout({ order: ["overview"], hidden: [] }, mods);
    expect(out.order).toContain("focus" as never);
    expect(out.hidden).toContain("focus" as never);
  });

  it("损坏 JSON 回退默认布局", async () => {
    await setSetting("stats.layout.v1", "not-json");
    await expect(getStatsLayout(MODS)).resolves.toEqual(DEFAULT_STATS_LAYOUT(MODS));
  });
});
