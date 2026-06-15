import type { HealthChartConfig, HealthRun, MetricChartBlock } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db/index.ts";
import {
  buildHealthSummary,
  buildRunPaceTrend,
  computeSleepDurationHours,
  formatDuration,
  formatPace,
  secondsPerKm,
  type HealthMetricCollections,
} from "../lib/healthMetrics/index.ts";
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
import type { HealthSummaryCardItem } from "./stats/health/HealthSummaryCards.tsx";

function isValidRun(run: HealthRun): run is HealthRun & { distanceKm: number; durationSeconds: number } {
  return (
    typeof run.distanceKm === "number" &&
    Number.isFinite(run.distanceKm) &&
    run.distanceKm > 0 &&
    typeof run.durationSeconds === "number" &&
    Number.isFinite(run.durationSeconds) &&
    run.durationSeconds > 0
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatHours(value: number | null): string {
  return value == null ? "--" : `${value.toFixed(1)}h`;
}

function formatInteger(value: number | null, unit = ""): string {
  return value == null ? "--" : `${Math.round(value)}${unit}`;
}

function formatDistance(value: number | null): string {
  return value == null ? "--" : `${value.toFixed(1)}km`;
}

function formatPaceLabel(value: number | null): string {
  return value == null ? "--" : `${formatPace(value)}/km`;
}

function averageDetail(values: number[], formatter: (value: number | null) => string): string {
  const average = mean(values);
  return average == null ? "--" : formatter(average);
}

function buildSummaryCards(
  summary: ReturnType<typeof buildHealthSummary>,
  collections: HealthMetricCollections,
): HealthSummaryCardItem[] {
  const sleepDurations = (collections.sleeps ?? []).map((row) => computeSleepDurationHours(row));
  const hrvValues = (collections.hrvs ?? []).map((row) => row.hrvMs);
  const stressValues = (collections.stresses ?? []).map((row) => row.stress);
  const heartRateValues = (collections.heartRates ?? [])
    .map((row) => row.restingHeartRate ?? row.avgHeartRate)
    .filter((value): value is number => value != null);
  const runs = collections.runs ?? [];
  const validRuns = runs.filter(isValidRun);
  const latestRuns = [...validRuns].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).slice(-5);
  const runDistance = validRuns.reduce((sum, run) => sum + run.distanceKm, 0);
  const runDuration = latestRuns.reduce((sum, run) => sum + run.durationSeconds, 0);
  const runDistanceForPace = latestRuns.reduce((sum, run) => sum + run.distanceKm, 0);
  const runAveragePace = secondsPerKm(runDuration, runDistanceForPace);

  return [
    {
      id: "sleep",
      label: summary.byId.sleep.label,
      value: formatHours(summary.byId.sleep.value),
      detail: `近7日均值 ${averageDetail(sleepDurations.slice(-7), formatHours)}`,
      tone: "sleep",
    },
    {
      id: "hrv",
      label: summary.byId.hrv.label,
      value: formatInteger(summary.byId.hrv.value, "ms"),
      detail: `近7日均值 ${averageDetail(hrvValues.slice(-7), (value) => formatInteger(value, "ms"))}`,
      tone: "hrv",
    },
    {
      id: "heartRate",
      label: summary.byId.heartRate.label,
      value: formatInteger(summary.byId.heartRate.value, "bpm"),
      detail: `近7日均值 ${averageDetail(heartRateValues.slice(-7), (value) => formatInteger(value, "bpm"))}`,
      tone: "heart",
    },
    {
      id: "stress",
      label: summary.byId.stress.label,
      value: formatInteger(summary.byId.stress.value),
      detail: `近7日均值 ${averageDetail(stressValues.slice(-7), (value) => formatInteger(value))}`,
      tone: "stress",
    },
    {
      id: "runs",
      label: summary.byId.run.label,
      value: `${runs.length}次`,
      detail: `总距离 ${formatDistance(runDistance)} · 最近 5 次均速 ${formatPaceLabel(runAveragePace)}`,
      tone: "run",
    },
  ];
}

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
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<MetricChartBlock | null>(null);

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
    scoped.heartRates.length > 0 ||
    scoped.hrvs.length > 0 ||
    scoped.sleeps.length > 0 ||
    scoped.stresses.length > 0 ||
    scoped.runs.length > 0;

  const seriesRange = rangeToChartSeriesRange(activePreset);
  const summary = useMemo(() => buildHealthSummary(scoped), [scoped]);
  const summaryCards = useMemo(() => buildSummaryCards(summary, scoped), [summary, scoped]);
  const paceTrend = useMemo(() => buildRunPaceTrend(scoped.runs), [scoped.runs]);
  const recentRuns = useMemo(
    () => [...scoped.runs].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)).slice(0, 5),
    [scoped.runs],
  );

  function handleAddChart() {
    setEditing(null);
    setBuilderOpen(true);
  }

  function handleEdit(block: HealthChartConfig) {
    if (block.type !== "metricChart") return;
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
        <>
          <HealthBlockList
            blocks={blocks}
            collections={fullCollections}
            range={seriesRange}
            summaryItems={summaryCards}
            runPace={paceTrend}
            onEdit={handleEdit}
            onDelete={(id) => {
              void handleDelete(id);
            }}
          />
          <section className="health-panel" aria-label="最近跑步">
            <div className="health-panel-header">
              <h3 className="health-panel-title">最近跑步</h3>
              <span className="health-panel-meta">{recentRuns.length} 条</span>
            </div>

            {recentRuns.length === 0 ? (
              <div className="health-empty-inline">暂无跑步数据</div>
            ) : (
              <div className="health-run-list">
                {recentRuns.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  return (
                    <article key={run.id} className="health-run-row">
                      <button
                        type="button"
                        className="health-run-summary"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedRunId((current) => (current === run.id ? null : run.id))}
                      >
                        <span className="health-run-date">{run.date}</span>
                        <span className="health-run-distance">{formatDistance(run.distanceKm)}</span>
                        <span className="health-run-pace">{formatPaceLabel(secondsPerKm(run.durationSeconds, run.distanceKm))}</span>
                        <span className="health-run-hr">{formatInteger(run.averageHeartRate, "bpm")}</span>
                        <span className="health-run-city">{run.city || "--"}</span>
                        <span className="health-run-toggle">{isExpanded ? "收起" : "展开"}</span>
                      </button>

                      {isExpanded && (
                        <div className="health-run-detail">
                          <DetailItem label="开始时间" value={run.startTime} />
                          <DetailItem label="时长" value={formatDuration(run.durationSeconds)} />
                          <DetailItem label="步频" value={run.averageCadence != null ? `${run.averageCadence.toFixed(1)} spm` : "--"} />
                          <DetailItem label="步幅" value={run.averageStrideM != null ? `${run.averageStrideM.toFixed(2)} m` : "--"} />
                          <DetailItem
                            label="触地时间"
                            value={run.averageGroundContactMs != null ? `${run.averageGroundContactMs} ms` : "--"}
                          />
                          <DetailItem
                            label="垂直振幅"
                            value={run.averageVerticalOscillationCm != null ? `${run.averageVerticalOscillationCm.toFixed(1)} cm` : "--"}
                          />
                          <DetailItem
                            label="垂直比"
                            value={run.averageVerticalRatioPercent != null ? `${run.averageVerticalRatioPercent.toFixed(2)}%` : "--"}
                          />
                          <DetailItem label="城市" value={run.city || "--"} />
                          <DetailItem label="类型" value={run.type || "--"} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="health-run-detail-row">
      <span className="health-run-detail-label">{label}</span>
      <span className="health-run-detail-value">{value}</span>
    </div>
  );
}
