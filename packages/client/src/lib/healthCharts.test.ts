import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { db } from "../db/index.js";
import { getSetting } from "./settings/index.js";
import {
  deleteHealthChartBlock,
  listHealthChartBlocks,
  putHealthChartBlock,
  seedDefaultHealthChartsOnce,
} from "./healthCharts.js";

beforeEach(async () => {
  await db.healthCharts.clear();
  await db.syncLog.clear();
  await db.settings.clear();
});

describe("healthCharts repo", () => {
  it("put 写表并产生 syncLog", async () => {
    const block = await putHealthChartBlock({
      type: "metricChart",
      title: "趋势",
      metricIds: ["hrv.value"],
      chartKind: "line",
      trendMode: "auto",
      rollingWindows: [7],
      showAverageLine: false,
      order: 0,
    });

    expect((await listHealthChartBlocks())[0].id).toBe(block.id);
    const logs = await db.syncLog.where("tableName").equals("health_charts").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("create");
  });

  it("delete 写表并产生 delete syncLog", async () => {
    const block = await putHealthChartBlock({
      type: "summary",
      title: "摘要",
      order: 0,
    });

    await deleteHealthChartBlock(block.id);

    expect(await listHealthChartBlocks()).toHaveLength(0);
    const logs = await db.syncLog.where("tableName").equals("health_charts").toArray();
    expect(logs.some((l) => l.action === "delete")).toBe(true);
  });

  it("首次注入三块默认并置标志", async () => {
    await seedDefaultHealthChartsOnce();

    const blocks = await listHealthChartBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["summary", "metricChart", "runTrend"]);
    expect(await getSetting("health.charts.seededV1")).toBe("1");
  });

  it("标志已置时不重复注入", async () => {
    await seedDefaultHealthChartsOnce();
    await db.healthCharts.clear();

    await seedDefaultHealthChartsOnce();

    expect(await listHealthChartBlocks()).toHaveLength(0);
  });
});
