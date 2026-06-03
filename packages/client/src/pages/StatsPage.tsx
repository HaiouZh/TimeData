import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../db/index.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { useInView } from "../hooks/useInView.ts";
import { memoAnomalies, memoOverview, memoRoutine, memoStructure, memoTrend } from "../lib/insights/cache.ts";
import { INSIGHT_CONSTANTS } from "../lib/insights/constants.ts";
import { type buildRoutineInsights, formatClockFromMinute } from "../lib/insights/routine.ts";
import type { Anomaly } from "../lib/insights/types.ts";
import { type ParentTrend, resolveTrendWindow, type TrendWindowSpec } from "../lib/insights/trends.ts";
import { useSleepCategoryId } from "../lib/sleepCategorySetting.ts";
import {
  buildStatsRangeForDate,
  formatStatsRangeLabel,
  isLatestPeriod,
  type StatsViewMode,
  shiftStatsAnchor,
} from "../lib/stats.ts";
import { addDays, getDateString } from "../lib/time.ts";
import {
  CategoryCompositionBars,
  CategoryDonut,
  type CompositionParent,
  TrendChart,
  type TrendChartKind,
  type TrendChartRow,
} from "./stats/InsightCharts.tsx";

type ViewMode = StatsViewMode;

const ANOMALY_LABEL: Record<string, string> = {
  overlong: "超长记录",
  overnight: "跨午夜",
  sleepTimeActivity: "睡眠时段活动",
  longGap: "长空挡",
  unrecordedDay: "未记录日",
};

const TREND_PRESETS: { days: number; label: string }[] = [
  { days: 7, label: "近7天" },
  { days: 30, label: "近30天" },
  { days: 90, label: "近90天" },
];

function trendLabel(t: ParentTrend): string {
  const curH = (t.currentMin / 60).toFixed(1);
  if (t.state === "compared" && t.deltaPct !== null) {
    const sign = t.deltaPct > 0 ? "↑" : t.deltaPct < 0 ? "↓" : "→";
    return `${curH}h（环比 ${sign}${Math.abs(t.deltaPct)}%）`;
  }
  if (t.state === "new") return `${curH}h（新增·无对比期数据）`;
  if (t.state === "dropped") return `本期未投入（上期 ${(t.previousMin / 60).toFixed(1)}h）`;
  return `${curH}h（无对比期数据）`;
}

function formatHoursFromMin(minutes: number | null): string {
  if (minutes === null) return "--";
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatDurationFromMin(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "--";
  if (minutes < 60) return `${Math.round(minutes)}min`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function routineStateText(state: ReturnType<typeof buildRoutineInsights>["regularity"]["state"]): string {
  if (state === "stable") return "作息较稳定";
  if (state === "variable") return "作息波动较大";
  if (state === "insufficientSamples") return "样本不足，仅展示原始指标";
  if (state === "noSamples") return "暂无睡眠样本";
  return "未配置睡眠分类";
}

interface AnomalyDateGroup {
  date: string;
  items: Anomaly[];
}

function groupAnomaliesByDate(items: Anomaly[]): AnomalyDateGroup[] {
  const groups = new Map<string, Anomaly[]>();
  for (const item of items) {
    const group = groups.get(item.date) ?? [];
    group.push(item);
    groups.set(item.date, group);
  }
  return Array.from(groups.entries()).map(([date, groupItems]) => ({ date, items: groupItems }));
}

function formatAnomalyTimeRange(anomaly: Anomaly): string | null {
  if (!anomaly.startTime || !anomaly.endTime) return null;
  const start = utcToLocalDateTime(anomaly.startTime);
  const end = utcToLocalDateTime(anomaly.endTime);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);
  if (startDate === endDate) return `${start.slice(11, 16)} - ${end.slice(11, 16)}`;
  return `${startDate.slice(5)} ${start.slice(11, 16)} - ${endDate.slice(5)} ${end.slice(11, 16)}`;
}

export default function StatsPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [today, setToday] = useState(() => getDateString(new Date()));
  const [anchor, setAnchor] = useState(() => getDateString(new Date()));
  const { parentCategories, categories } = useCategories();

  useEffect(() => {
    const refreshToday = () =>
      setToday((current) => {
        const next = getDateString(new Date());
        return next === current ? current : next;
      });
    const timer = window.setInterval(refreshToday, 60_000);
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", refreshToday);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", refreshToday);
    };
  }, []);

  const statsRange = useMemo(() => buildStatsRangeForDate(mode, anchor), [mode, anchor]);
  const baselineFrom = useMemo(() => addDays(today, -(INSIGHT_CONSTANTS.baselineWindowDays - 1)), [today]);
  const atLatest = isLatestPeriod(mode, anchor, today);
  const effectiveToDate = atLatest && statsRange.toDate > today ? today : statsRange.toDate;
  const effectiveRange = useMemo(
    () => ({
      ...statsRange,
      toDate: effectiveToDate,
      endUtc: localDateTimeToUtc(`${addDays(effectiveToDate, 1)}T00:00:00`),
    }),
    [statsRange, effectiveToDate],
  );
  const rangeClampedToToday = effectiveRange.toDate !== statsRange.toDate;
  const rangeLabel = formatStatsRangeLabel(mode, statsRange);
  const periodUnit = { day: "天", week: "周", month: "月" }[mode];

  const baselineEntries =
    useLiveQuery(async () => {
      const startUtc = localDateTimeToUtc(`${baselineFrom}T00:00:00`);
      const endUtc = localDateTimeToUtc(`${addDays(today, 1)}T00:00:00`);
      const candidates = await db.timeEntries.where("endTime").above(startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < endUtc);
    }, [baselineFrom, today]) || [];

  const periodWithinBaseline = effectiveRange.fromDate >= baselineFrom;
  const periodFallback =
    useLiveQuery(async () => {
      if (periodWithinBaseline) return [];
      const candidates = await db.timeEntries.where("endTime").above(effectiveRange.startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < effectiveRange.endUtc);
    }, [periodWithinBaseline, effectiveRange.startUtc, effectiveRange.endUtc]) || [];

  const entries = useMemo(() => {
    if (!periodWithinBaseline) return periodFallback;
    return baselineEntries.filter(
      (entry) => entry.endTime > effectiveRange.startUtc && entry.startTime < effectiveRange.endUtc,
    );
  }, [periodWithinBaseline, periodFallback, baselineEntries, effectiveRange.startUtc, effectiveRange.endUtc]);

  const parentNameById = useMemo(() => new Map(parentCategories.map((c) => [c.id, c.name])), [parentCategories]);

  const sleepCategoryId = useSleepCategoryId();

  const overview = useMemo(
    () =>
      memoOverview({
        entries,
        categories,
        fromDate: effectiveRange.fromDate,
        toDate: effectiveRange.toDate,
        sleepCategoryId,
      }),
    [entries, categories, effectiveRange.fromDate, effectiveRange.toDate, sleepCategoryId],
  );

  const pieData = useMemo(
    () =>
      overview.parents.map((parent) => ({
        id: parent.parentId,
        name: parent.name,
        value: parent.totalHours,
        color: parent.color,
      })),
    [overview],
  );

  const compositionParents = useMemo<CompositionParent[]>(
    () =>
      overview.parents.map((parent) => ({
        id: parent.parentId,
        name: parent.name,
        totalHours: parent.totalHours,
        sharePct: parent.sharePct,
        color: parent.color,
        children: parent.children.map((child) => ({
          id: child.categoryId,
          name: child.name,
          min: child.totalMin,
          color: child.color,
        })),
      })),
    [overview],
  );

  const totalHours = overview.totalRecordedHours;

  const routine = useMemo(
    () =>
      memoRoutine({
        entries,
        categories,
        fromDate: effectiveRange.fromDate,
        toDate: effectiveRange.toDate,
        sleepCategoryId,
      }),
    [entries, categories, effectiveRange.fromDate, effectiveRange.toDate, sleepCategoryId],
  );

  const anomalies = useMemo(
    () =>
      memoAnomalies({
        entries,
        baselineEntries,
        categories,
        fromDate: effectiveRange.fromDate,
        toDate: effectiveRange.toDate,
        baselineFromDate: baselineFrom,
        baselineToDate: today,
        sleepCategoryId,
        sleepWindow: routine.sleepWindow,
      }),
    [
      entries,
      baselineEntries,
      categories,
      effectiveRange.fromDate,
      effectiveRange.toDate,
      baselineFrom,
      today,
      sleepCategoryId,
      routine.sleepWindow,
    ],
  );

  const anomalyDateGroups = useMemo(() => groupAnomaliesByDate(anomalies), [anomalies]);
  const longGapAnomalies = useMemo(
    () =>
      anomalies
        .filter((anomaly) => anomaly.type === "longGap")
        .sort((a, b) => (b.valueMin ?? 0) - (a.valueMin ?? 0)),
    [anomalies],
  );
  const anomalyStats = useMemo(() => {
    const longGapCount = longGapAnomalies.length;
    const longGapTotalMin = longGapAnomalies.reduce((sum, anomaly) => sum + (anomaly.valueMin ?? 0), 0);
    const unrecordedDayCount = anomalies.filter((anomaly) => anomaly.type === "unrecordedDay").length;
    const recordIssueCount = anomalies.filter(
      (anomaly) => anomaly.type === "overlong" || anomaly.type === "overnight" || anomaly.type === "sleepTimeActivity",
    ).length;
    return {
      longGapCount,
      longGapTotalMin,
      longestGapMin: longGapAnomalies[0]?.valueMin ?? null,
      unrecordedDayCount,
      recordIssueCount,
    };
  }, [anomalies, longGapAnomalies]);

  const [trendWindowSpec, setTrendWindowSpec] = useState<TrendWindowSpec>({ kind: "preset", days: 7 });
  const [trendChart, setTrendChart] = useState<TrendChartKind>("line");

  const trendWindow = useMemo(() => resolveTrendWindow(trendWindowSpec, today), [trendWindowSpec, today]);

  const trendWithinBaseline = trendWindow.prevFrom >= baselineFrom;
  const trendFallback =
    useLiveQuery(async () => {
      if (trendWithinBaseline) return [];
      const startUtc = localDateTimeToUtc(`${trendWindow.prevFrom}T00:00:00`);
      const endUtc = localDateTimeToUtc(`${addDays(trendWindow.to, 1)}T00:00:00`);
      const candidates = await db.timeEntries.where("endTime").above(startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < endUtc);
    }, [trendWithinBaseline, trendWindow.prevFrom, trendWindow.to]) || [];

  const trendEntries = useMemo(() => {
    if (!trendWithinBaseline) return trendFallback;
    const startUtc = localDateTimeToUtc(`${trendWindow.prevFrom}T00:00:00`);
    const endUtc = localDateTimeToUtc(`${addDays(trendWindow.to, 1)}T00:00:00`);
    return baselineEntries.filter((entry) => entry.endTime > startUtc && entry.startTime < endUtc);
  }, [trendWithinBaseline, trendFallback, baselineEntries, trendWindow.prevFrom, trendWindow.to]);

  const trend = useMemo(
    () => memoTrend(trendEntries, categories, trendWindow),
    [trendEntries, categories, trendWindow],
  );

  // 折线/面积图行数据：每行一天，键为父分类名，值为小时。
  const trendChartData = useMemo(
    () =>
      trend.points.map((point) => {
        const row: TrendChartRow = { date: point.date.slice(5) };
        for (const t of trend.parentTrends) {
          row[parentNameById.get(t.parentId) ?? t.parentId] =
            Math.round(((point.byParent[t.parentId] ?? 0) / 60) * 10) / 10;
        }
        return row;
      }),
    [trend, parentNameById],
  );
  const trendSeries = useMemo(
    () =>
      trend.parentTrends.map((t) => ({
        key: parentNameById.get(t.parentId) ?? t.parentId,
        color: parentCategories.find((c) => c.id === t.parentId)?.color ?? "#808080",
    })),
    [trend, parentNameById, parentCategories],
  );

  const structure = useMemo(
    () =>
      memoStructure({
        periodEntries: entries,
        baselineEntries,
        categories,
        periodFrom: effectiveRange.fromDate,
        periodTo: effectiveRange.toDate,
        baselineFrom,
        baselineTo: today,
        sleepCategoryId,
      }),
    [
      entries,
      baselineEntries,
      categories,
      effectiveRange.fromDate,
      effectiveRange.toDate,
      baselineFrom,
      today,
      sleepCategoryId,
    ],
  );
  const [chartsRef, chartsInView] = useInView<HTMLDivElement>();

  return (
    <div ref={chartsRef} className="p-4 space-y-6">
      <div className="flex gap-2">
        {(["day", "week", "month"] as ViewMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`px-3 py-1.5 rounded text-sm ${mode === m ? "bg-blue-600" : "bg-slate-800 text-slate-400"}`}
          >
            {{ day: "日", week: "周", month: "月" }[m]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={`上一${periodUnit}`}
          onClick={() => setAnchor((current) => shiftStatsAnchor(mode, current, -1))}
          className="px-3 py-1.5 rounded text-sm bg-slate-800 text-slate-300"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-200">{rangeLabel}</span>
          <input
            type="date"
            value={statsRange.fromDate}
            max={today}
            onChange={(event) => {
              if (event.target.value) setAnchor(event.target.value);
            }}
            className="bg-slate-800 text-slate-300 text-sm rounded px-2 py-1"
          />
        </div>
        <button
          type="button"
          aria-label={`下一${periodUnit}`}
          disabled={atLatest}
          onClick={() => setAnchor((current) => shiftStatsAnchor(mode, current, 1))}
          className="px-3 py-1.5 rounded text-sm bg-slate-800 text-slate-300 disabled:opacity-40"
        >
          →
        </button>
      </div>
      {!atLatest && (
        <button
          type="button"
          onClick={() => setAnchor(today)}
          className="mx-auto block px-3 py-1 rounded text-xs bg-slate-800 text-slate-400"
        >
          回到今天
        </button>
      )}
      <div className="text-center text-sm text-slate-400">
        已记录 {totalHours.toFixed(1)} 小时
        {rangeClampedToToday && <span> · 截至 {effectiveRange.toDate}</span>}
      </div>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-slate-200">总览</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <div className="text-xs text-slate-500">本周期总时长</div>
            <div className="mt-1 text-slate-100">{overview.totalRecordedHours.toFixed(1)}h</div>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <div className="text-xs text-slate-500">记录覆盖率</div>
            <div className="mt-1 text-slate-100">{overview.coverageDisplayPct.toFixed(1)}%</div>
            {overview.coverageNote && <div className="mt-1 text-xs text-slate-500">{overview.coverageNote}</div>}
          </div>
        </div>
        {compositionParents.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">父分类 → 子分类构成</div>
            <CategoryCompositionBars parents={compositionParents} />
          </div>
        )}
      </section>
      {pieData.length > 0 && (
        <div className="space-y-3">
          {chartsInView ? (
            <CategoryDonut
              data={pieData}
              totalHours={overview.totalRecordedHours}
              coveragePct={overview.coverageDisplayPct}
              coverageNote={overview.coverageNote}
            />
          ) : (
            <div className="min-h-[250px]" />
          )}
        </div>
      )}
      {pieData.length === 0 && <div className="text-center text-slate-500 py-12">暂无统计数据</div>}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-slate-200">作息</h3>
        {sleepCategoryId === null ? (
          <Link
            to="/settings/insights"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            设置睡眠分类后可查看作息分析
            <span aria-hidden>›</span>
          </Link>
        ) : routine.sampleCount === 0 ? (
          <p className="text-sm text-slate-500">本周期暂无睡眠样本。</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">平均入睡</div>
                <div className="mt-1 text-slate-100">{formatClockFromMinute(routine.averageBedTimeMin)}</div>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">平均起床</div>
                <div className="mt-1 text-slate-100">{formatClockFromMinute(routine.averageWakeTimeMin)}</div>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">平均睡眠</div>
                <div className="mt-1 text-slate-100">{formatHoursFromMin(routine.averageDurationMin)}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {routineStateText(routine.regularity.state)} · 样本 {routine.sampleCount} 天
              {routine.sleepWindow.source === "samples" &&
                ` · 通常睡眠时段 ${formatClockFromMinute(routine.sleepWindow.startMin)}~${formatClockFromMinute(routine.sleepWindow.endMin)}`}
            </p>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-200">异常与空挡</h3>
          {anomalies.length > 0 && (
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{anomalies.length} 项</span>
          )}
        </div>
        {anomalies.length === 0 ? (
          <p className="text-sm text-slate-500">本周期未发现明显异常或长空挡。</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">长空挡</div>
                <div className="mt-1 text-slate-100">{anomalyStats.longGapCount}</div>
                <div className="mt-1 text-xs text-slate-500">
                  最长 {formatDurationFromMin(anomalyStats.longestGapMin)}
                </div>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">空挡合计</div>
                <div className="mt-1 text-slate-100">{formatDurationFromMin(anomalyStats.longGapTotalMin)}</div>
                <div className="mt-1 text-xs text-slate-500">超过个人阈值</div>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="text-xs text-slate-500">记录异常</div>
                <div className="mt-1 text-slate-100">{anomalyStats.recordIssueCount}</div>
                <div className="mt-1 text-xs text-slate-500">未记录日 {anomalyStats.unrecordedDayCount}</div>
              </div>
            </div>

            {longGapAnomalies.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500">长空挡 Top</div>
                <ul className="space-y-1.5">
                  {longGapAnomalies.slice(0, 5).map((anomaly, index) => (
                    <li
                      key={`top:${anomaly.date}:${anomaly.startTime ?? ""}:${anomaly.endTime ?? ""}:${index}`}
                      className="flex items-center justify-between gap-3 rounded bg-slate-800/60 px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 text-slate-300">
                        {anomaly.date}
                        {formatAnomalyTimeRange(anomaly) && (
                          <span className="ml-2 text-xs text-slate-500">{formatAnomalyTimeRange(anomaly)}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-slate-100">{formatDurationFromMin(anomaly.valueMin)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <details className="space-y-2" open={mode !== "month"}>
              <summary className="cursor-pointer text-xs text-slate-500">按日期分布</summary>
              <div className="mt-2 space-y-2">
                {anomalyDateGroups.map((group) => (
                  <div key={group.date} className="rounded-lg bg-slate-800/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-200">{group.date}</span>
                      <span className="text-xs text-slate-500">{group.items.length} 项</span>
                    </div>
                    <ul className="mt-2 divide-y divide-slate-700/60">
                      {group.items.map((anomaly, index) => {
                        const timeRange = formatAnomalyTimeRange(anomaly);
                        return (
                          <li
                            key={`${anomaly.type}:${anomaly.date}:${anomaly.startTime ?? ""}:${anomaly.endTime ?? ""}:${index}`}
                            className="py-2 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                                {ANOMALY_LABEL[anomaly.type] ?? anomaly.type}
                              </span>
                              {timeRange && <span className="text-xs text-slate-500">{timeRange}</span>}
                              {anomaly.valueMin !== undefined && (
                                <span className="text-xs text-slate-400">
                                  {formatDurationFromMin(anomaly.valueMin)}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-slate-300">{anomaly.message}</p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-slate-200">趋势变化</h3>
        <div className="flex flex-wrap items-center gap-2">
          {TREND_PRESETS.map((preset) => {
            const active = trendWindowSpec.kind === "preset" && trendWindowSpec.days === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                aria-pressed={active}
                onClick={() => setTrendWindowSpec({ kind: "preset", days: preset.days })}
                className={`px-2.5 py-1 rounded text-xs ${active ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}
              >
                {preset.label}
              </button>
            );
          })}
          <input
            type="number"
            min={1}
            max={365}
            placeholder="自定义天数"
            aria-label="自定义天数"
            onChange={(event) => {
              const days = Number(event.target.value);
              if (Number.isFinite(days) && days >= 1) setTrendWindowSpec({ kind: "customDays", days });
            }}
            className="w-24 bg-slate-800 text-slate-300 text-xs rounded px-2 py-1"
          />
          <span className="text-xs text-slate-500">或</span>
          <input
            type="date"
            max={today}
            aria-label="趋势起始日"
            value={trendWindowSpec.kind === "customRange" ? trendWindowSpec.from : ""}
            onChange={(event) => {
              const from = event.target.value;
              if (from) {
                const to = trendWindowSpec.kind === "customRange" ? trendWindowSpec.to : today;
                setTrendWindowSpec({ kind: "customRange", from, to: to < from ? from : to });
              }
            }}
            className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1"
          />
          <input
            type="date"
            max={today}
            aria-label="趋势结束日"
            value={trendWindowSpec.kind === "customRange" ? trendWindowSpec.to : ""}
            onChange={(event) => {
              const to = event.target.value;
              if (to) {
                const from = trendWindowSpec.kind === "customRange" ? trendWindowSpec.from : to;
                setTrendWindowSpec({ kind: "customRange", from: from > to ? to : from, to });
              }
            }}
            className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1"
          />
        </div>

        <div className="text-xs text-slate-500">
          {trend.window.from} ~ {trend.window.to}
          {!trend.prevComparable && "（对比期数据不足，仅显示本期投入）"}
        </div>

        {trend.parentTrends.length === 0 ? (
          <p className="text-sm text-slate-500">本期窗口无投入记录。</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {trend.parentTrends.map((t) => (
                <li
                  key={t.parentId}
                  className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-1.5 text-sm"
                >
                  <span className="text-slate-200">{parentNameById.get(t.parentId) ?? t.parentId}</span>
                  <span
                    className={
                      t.state === "compared" && (t.deltaPct ?? 0) > 0
                        ? "text-emerald-400"
                        : t.state === "compared" && (t.deltaPct ?? 0) < 0
                          ? "text-rose-400"
                          : "text-slate-400"
                    }
                  >
                    {trendLabel(t)}
                  </span>
                </li>
              ))}
            </ul>

            {(trend.topRising.length > 0 || trend.topFalling.length > 0) && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-slate-400 mb-1">上升最多</div>
                  {trend.topRising.length === 0 ? (
                    <div className="text-slate-600">—</div>
                  ) : (
                    trend.topRising.map((t) => (
                      <div key={t.parentId} className="text-emerald-400">
                        {parentNameById.get(t.parentId) ?? t.parentId} ↑{t.deltaPct}%
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="text-slate-400 mb-1">下降最多</div>
                  {trend.topFalling.length === 0 ? (
                    <div className="text-slate-600">—</div>
                  ) : (
                    trend.topFalling.map((t) => (
                      <div key={t.parentId} className="text-rose-400">
                        {parentNameById.get(t.parentId) ?? t.parentId} ↓{Math.abs(t.deltaPct ?? 0)}%
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={trendChart === "line"}
                onClick={() => setTrendChart("line")}
                className={`px-2.5 py-1 rounded text-xs ${trendChart === "line" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}
              >
                折线
              </button>
              <button
                type="button"
                aria-pressed={trendChart === "area"}
                onClick={() => setTrendChart("area")}
                className={`px-2.5 py-1 rounded text-xs ${trendChart === "area" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}
              >
                堆叠面积
              </button>
            </div>

            {chartsInView ? (
              <TrendChart chart={trendChart} data={trendChartData} series={trendSeries} />
            ) : (
              <div className="min-h-[220px]" />
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-slate-200">结构诊断</h3>

        {structure.current.sessionCount === 0 ? (
          <p className="text-sm text-slate-500">本周期无足够会话用于结构诊断。</p>
        ) : (
          <>
            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">
                深度 vs 杂项{structure.excludedSleep ? "" : "（含睡眠，指定睡眠分类后更准）"}
              </div>
              <div>
                深度时间占比 <span className="text-emerald-400">{structure.current.deepRatioPct}%</span>
                <span className="text-slate-500">（基线 {structure.baseline.deepRatioPct}%）</span>
              </div>
              <div className="text-slate-400 text-xs">
                深度块 {structure.current.deepBlockCount} 个 · 深度门槛 ≥{" "}
                {Math.round(structure.thresholds.deepThresholdMin)}min · 中位会话 {structure.current.medianSessionMin}
                min（基线 {structure.baseline.medianSessionMin}min）
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">碎片化（仅供观察，不报警）</div>
              <div className="text-slate-300 text-xs">
                每活跃小时切换 {structure.fragment.switchesPerActiveHour} 次（基线{" "}
                {structure.fragment.baselineSwitchesPerActiveHour}） · 短会话占比{" "}
                {structure.fragment.shortSessionRatioPct}%（基线 {structure.fragment.baselineShortSessionRatioPct}%）
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">投入分散度（香农熵）</div>
              <div className="text-slate-300 text-xs">
                {structure.entropy.normalizedPct}%（H={structure.entropy.entropyBits} / {structure.entropy.parentCount}{" "}
                类）·
                {structure.entropy.normalizedPct >= 70 ? " 投入较分散" : " 投入较集中"}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-400 text-xs">占比失衡</div>
              {structure.baselineDaysWithData < INSIGHT_CONSTANTS.imbalanceMinDaysWithData ? (
                <p className="text-xs text-slate-500">
                  基线数据不足（需 ≥ {INSIGHT_CONSTANTS.imbalanceMinDaysWithData} 天），暂不评估占比失衡。
                </p>
              ) : structure.imbalances.length === 0 ? (
                <p className="text-xs text-slate-500">本周期各父分类占比均在你的常态范围内。</p>
              ) : (
                <ul className="space-y-1">
                  {structure.imbalances.map((item) => (
                    <li key={item.parentId} className="text-xs">
                      <span className="text-slate-200">{parentNameById.get(item.parentId) ?? item.parentId}</span>{" "}
                      <span className={item.direction === "high" ? "text-amber-400" : "text-sky-400"}>
                        {item.currentSharePct}%，{item.direction === "high" ? "高于" : "低于"}你的常态 （
                        {item.baselineMeanPct}%±{item.baselineStdevPct}%）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
