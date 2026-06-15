import { HealthChartConfigSchema, type HealthChartConfig } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { getSetting, setSetting } from "./settings/index.js";

const SEEDED_FLAG = "health.charts.seededV1";

export async function listHealthChartBlocks(): Promise<HealthChartConfig[]> {
  const rows = await db.healthCharts.toArray();
  return rows.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

type NewBlockInput =
  | (Omit<Extract<HealthChartConfig, { type: "metricChart" }>, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
  })
  | (Omit<Extract<HealthChartConfig, { type: "runTrend" }>, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
  })
  | (Omit<Extract<HealthChartConfig, { type: "summary" }>, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
  });

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

  await putHealthChartBlock({ type: "summary", title: "健康摘要", order: 0 });
  await putHealthChartBlock({
    type: "metricChart",
    title: "健康趋势",
    metricIds: ["sleep.duration", "hrv.value", "stress.value", "heart_rate.resting"],
    chartKind: "line",
    trendMode: "auto",
    rollingWindows: [7],
    showAverageLine: false,
    order: 1,
  });
  await putHealthChartBlock({ type: "runTrend", title: "跑步配速", order: 2 });
  await setSetting(SEEDED_FLAG, "1");
}
