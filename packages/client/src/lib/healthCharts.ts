import { HealthChartConfigSchema, type HealthChartConfig, type HealthChartConfigDraft } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { getSetting, setSetting } from "./settings/index.js";

const SEEDED_FLAG = "health.charts.seededV2";

export async function listHealthChartBlocks(): Promise<HealthChartConfig[]> {
  const rows = await db.healthCharts.toArray();
  return rows.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

type NewBlockInput = HealthChartConfigDraft;

export async function putHealthChartBlock(input: NewBlockInput): Promise<HealthChartConfig> {
  const now = new Date().toISOString();
  const existing = input.id ? await db.healthCharts.get(input.id) : undefined;
  const block = HealthChartConfigSchema.parse({
    ...input,
    id: input.id ?? uuid(),
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
  });

  await db.transaction("rw", db.healthCharts, db.syncLog, async () => {
    await db.healthCharts.put(block);
    await recordSyncLog("health_charts", block.id, existing ? "update" : "create", now);
  });

  return block;
}

export async function deleteHealthChartBlock(id: string): Promise<void> {
  await db.transaction("rw", db.healthCharts, db.syncLog, async () => {
    await db.healthCharts.delete(id);
    await recordSyncLog("health_charts", id, "delete");
  });
}

export async function seedDefaultHealthChartsOnce(): Promise<void> {
  if ((await getSetting(SEEDED_FLAG)) === "1") return;

  await putHealthChartBlock({
    view: "stat",
    source: "derived",
    title: "健康摘要",
    metricIds: ["sleep.duration", "hrv.value", "heart_rate.resting", "stress.value", "run.distance"],
    range: { mode: "inherit" },
    presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
    order: 0,
  });
  await putHealthChartBlock({
    view: "chart",
    source: "healthMetricDaily",
    title: "健康趋势",
    metricIds: ["sleep.duration", "hrv.value", "stress.value", "heart_rate.resting"],
    chartKind: "line",
    trendMode: "auto",
    rollingWindows: [7],
    showAverageLine: false,
    range: { mode: "inherit" },
    presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
    order: 1,
  });
  await setSetting(SEEDED_FLAG, "1");
}
