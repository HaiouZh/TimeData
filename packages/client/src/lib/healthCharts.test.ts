import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  deleteHealthChartBlock,
  listHealthChartBlocks,
  putHealthChartBlock,
  seedDefaultHealthChartsOnce,
} from "./healthCharts.js";
import { getSetting } from "./settings/index.js";

beforeEach(resetDb);

describe("healthCharts repo", () => {
  it("put 写表并产生 syncLog", async () => {
    const block = await putHealthChartBlock({
      view: "chart",
      source: "healthMetricDaily",
      title: "趋势",
      metricIds: ["hrv.value"],
      chartKind: "line",
      trendMode: "auto",
      rollingWindows: [7],
      showAverageLine: false,
      range: { mode: "inherit" },
      presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
      order: 0,
    });

    expect((await listHealthChartBlocks())[0].id).toBe(block.id);
    const logs = await db.syncLog.where("tableName").equals("health_charts").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("create");
  });

  it("delete 写表并产生 delete syncLog", async () => {
    const block = await putHealthChartBlock({
      view: "stat",
      source: "derived",
      title: "摘要",
      metricIds: ["sleep.duration"],
      range: { mode: "inherit" },
      presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
      order: 0,
    });

    await deleteHealthChartBlock(block.id);

    expect(await listHealthChartBlocks()).toHaveLength(0);
    const logs = await db.syncLog.where("tableName").equals("health_charts").toArray();
    expect(logs.some((l) => l.action === "delete")).toBe(true);
  });

  it("首次注入两块默认并置标志", async () => {
    await seedDefaultHealthChartsOnce();

    const blocks = await listHealthChartBlocks();
    expect(blocks.map((block) => `${block.view}:${block.source}`)).toEqual(["stat:derived", "chart:healthMetricDaily"]);
    expect(blocks.some((block) => block.source === "runs")).toBe(false);
    expect(await getSetting("health.charts.seededV2")).toBe("1");
  });

  it("标志已置时不重复注入", async () => {
    await seedDefaultHealthChartsOnce();
    await db.healthCharts.clear();

    await seedDefaultHealthChartsOnce();

    expect(await listHealthChartBlocks()).toHaveLength(0);
  });
});
