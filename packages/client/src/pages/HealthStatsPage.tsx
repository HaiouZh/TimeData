import type { HealthChartConfig } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db/index.ts";
import { buildHealthSummaryCardItems } from "../lib/healthBlocks/index.ts";
import {
  deleteHealthChartBlock,
  listHealthChartBlocks,
  putHealthChartBlock,
  seedDefaultHealthChartsOnce,
} from "../lib/healthCharts.ts";
import { useSetting } from "../lib/settings/index.ts";
import {
  HEALTH_RANGE_PRESETS_KEY,
  parseHealthRangePresets,
  rangeLabel,
  rangeToChartSeriesRange,
  type HealthRangePreset,
} from "../lib/settings/healthRangeSetting.ts";
import { ChartBuilderSheet, type BuilderDraft } from "./stats/health/ChartBuilderSheet.tsx";
import { HealthBlockList } from "./stats/health/HealthBlockList.tsx";

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function filterByPreset<T extends { date: string }>(records: readonly T[], preset: HealthRangePreset): T[] {
  if (preset === "all") return [...records];
  const days = Number(preset);
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - (days - 1));
  const from = formatLocalDate(fromDate);
  const to = formatLocalDate(today);
  return records.filter((record) => record.date >= from && record.date <= to);
}

function defaultPreset(presets: HealthRangePreset[]): HealthRangePreset {
  return presets.includes("30") ? "30" : (presets[0] ?? "30");
}

export default function HealthStatsPage() {
  const presetsRaw = useSetting(HEALTH_RANGE_PRESETS_KEY);
  const presets = useMemo(() => parseHealthRangePresets(presetsRaw), [presetsRaw]);
  const [preset, setPreset] = useState<HealthRangePreset>(() => defaultPreset(presets));
  const activePreset = presets.includes(preset) ? preset : defaultPreset(presets);
  const heartRates = useLiveQuery(() => db.healthHeartRate.orderBy("date").toArray()) ?? [];
  const hrvs = useLiveQuery(() => db.healthHrv.orderBy("date").toArray()) ?? [];
  const sleeps = useLiveQuery(() => db.healthSleep.orderBy("date").toArray()) ?? [];
  const stresses = useLiveQuery(() => db.healthStress.orderBy("date").toArray()) ?? [];
  const runs = useLiveQuery(() => db.runs.orderBy("date").toArray()) ?? [];
  const blocks = useLiveQuery(() => listHealthChartBlocks()) ?? [];
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<HealthChartConfig | null>(null);

  useEffect(() => {
    void seedDefaultHealthChartsOnce();
  }, []);

  const fullCollections = useMemo(
    () => ({ heartRates, hrvs, sleeps, stresses, runs }),
    [heartRates, hrvs, sleeps, stresses, runs],
  );

  const scoped = useMemo(
    () => ({
      heartRates: filterByPreset(heartRates, activePreset),
      hrvs: filterByPreset(hrvs, activePreset),
      sleeps: filterByPreset(sleeps, activePreset),
      stresses: filterByPreset(stresses, activePreset),
      runs: filterByPreset(runs, activePreset),
    }),
    [heartRates, hrvs, sleeps, stresses, runs, activePreset],
  );

  const hasAnyData =
    fullCollections.heartRates.length > 0 ||
    fullCollections.hrvs.length > 0 ||
    fullCollections.sleeps.length > 0 ||
    fullCollections.stresses.length > 0 ||
    fullCollections.runs.length > 0;

  const seriesRange = rangeToChartSeriesRange(activePreset);
  const summaryCards = useMemo(() => buildHealthSummaryCardItems(scoped), [scoped]);

  function handleAddChart() {
    setEditing(null);
    setBuilderOpen(true);
  }

  function handleEdit(block: HealthChartConfig) {
    setEditing(block);
    setBuilderOpen(true);
  }

  async function handleDelete(id: string) {
    await deleteHealthChartBlock(id);
    setEditing((current) => (current?.id === id ? null : current));
  }

  async function handleSave(draft: BuilderDraft) {
    await putHealthChartBlock(draft);
    setBuilderOpen(false);
    setEditing(null);
  }

  function handleCloseBuilder() {
    setBuilderOpen(false);
    setEditing(null);
  }

  return (
    <div className="health-stats-page">
      <header className="health-page-header">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="health-kicker">TimeData</div>
            <h2 className="health-page-title">健康统计</h2>
          </div>
          <button
            type="button"
            aria-label="添加图表"
            onClick={handleAddChart}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xl leading-none text-slate-100 shadow-sm transition hover:border-slate-500 hover:bg-slate-800"
          >
            ＋
          </button>
        </div>
        <div className="health-range-selector" role="tablist" aria-label="健康范围">
          {presets.map((item) => (
            <button
              key={item}
              type="button"
              className="health-range-button"
              aria-pressed={activePreset === item}
              onClick={() => setPreset(item)}
            >
              {rangeLabel(item)}
            </button>
          ))}
        </div>
      </header>

      {!hasAnyData ? (
        <div className="health-empty-state">暂无健康数据</div>
      ) : (
        <HealthBlockList
          blocks={blocks}
          collections={fullCollections}
          range={seriesRange}
          summaryItems={summaryCards}
          onEdit={handleEdit}
          onDelete={(id) => {
            void handleDelete(id);
          }}
        />
      )}

      {builderOpen && (
        <ChartBuilderSheet
          open
          initial={editing}
          onSave={(draft) => {
            void handleSave(draft);
          }}
          onClose={handleCloseBuilder}
          onDelete={(id) => {
            void handleDelete(id);
            setBuilderOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
