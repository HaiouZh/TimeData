import type { HealthRun } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db/index.ts";
import {
  buildHealthSummary,
  buildNormalizedHealthTrend,
  buildRunPaceTrend,
  computeSleepDurationHours,
  filterHealthRecordsByRange,
  formatDuration,
  formatPace,
  secondsPerKm,
  type HealthMetricCollections,
  type HealthMetricRange,
} from "../lib/healthMetrics/index.ts";
import { HealthMetricTrendChart } from "./stats/health/HealthMetricTrendChart.tsx";
import { HealthSummaryCards, type HealthSummaryCardItem } from "./stats/health/HealthSummaryCards.tsx";
import { RunPaceTrendChart } from "./stats/health/RunPaceTrendChart.tsx";

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

export default function HealthStatsPage() {
  const [range, setRange] = useState<HealthMetricRange>("30");
  const heartRates = useLiveQuery(() => db.healthHeartRate.orderBy("date").toArray()) ?? [];
  const hrvs = useLiveQuery(() => db.healthHrv.orderBy("date").toArray()) ?? [];
  const sleeps = useLiveQuery(() => db.healthSleep.orderBy("date").toArray()) ?? [];
  const stresses = useLiveQuery(() => db.healthStress.orderBy("date").toArray()) ?? [];
  const runs = useLiveQuery(() => db.runs.orderBy("date").toArray()) ?? [];
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const scoped = useMemo(
    () => ({
      heartRates: filterHealthRecordsByRange(heartRates, range),
      hrvs: filterHealthRecordsByRange(hrvs, range),
      sleeps: filterHealthRecordsByRange(sleeps, range),
      stresses: filterHealthRecordsByRange(stresses, range),
      runs: filterHealthRecordsByRange(runs, range),
    }),
    [heartRates, hrvs, sleeps, stresses, runs, range],
  );

  const hasAnyData =
    scoped.heartRates.length > 0 ||
    scoped.hrvs.length > 0 ||
    scoped.sleeps.length > 0 ||
    scoped.stresses.length > 0 ||
    scoped.runs.length > 0;

  const summary = useMemo(() => buildHealthSummary(scoped), [scoped]);
  const summaryCards = useMemo(() => buildSummaryCards(summary, scoped), [summary, scoped]);
  const normalizedTrend = useMemo(() => buildNormalizedHealthTrend(scoped), [scoped]);
  const paceTrend = useMemo(() => buildRunPaceTrend(scoped.runs ?? []), [scoped.runs]);
  const recentRuns = useMemo(
    () => [...(scoped.runs ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)).slice(0, 5),
    [scoped.runs],
  );

  return (
    <div className="health-stats-page">
      <header className="health-page-header">
        <div className="min-w-0">
          <div className="health-kicker">TimeData</div>
          <h2 className="health-page-title">健康统计</h2>
        </div>
        <div className="health-range-selector" role="tablist" aria-label="健康范围">
          {(["30", "90", "all"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="health-range-button"
              aria-pressed={range === item}
              onClick={() => setRange(item)}
            >
              {item === "all" ? "全部" : `${item}天`}
            </button>
          ))}
        </div>
      </header>

      {!hasAnyData ? (
        <div className="health-empty-state">暂无健康数据</div>
      ) : (
        <>
          <HealthSummaryCards items={summaryCards} />
          <HealthMetricTrendChart data={normalizedTrend} />
          <RunPaceTrendChart data={paceTrend} />
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
