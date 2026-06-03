import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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

function metricToneClass(tone: "neutral" | "good" | "warn" | "danger" | "info" = "neutral"): string {
  return {
    neutral: "border-slate-800/80 bg-slate-900/70 text-slate-100",
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    danger: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    info: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  }[tone];
}

function SectionPanel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.35rem] border border-slate-800/80 bg-slate-950/70 p-4 shadow-[0_18px_48px_rgba(2,6,23,0.28)] ring-1 ring-white/[0.03]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{eyebrow}</div>
          )}
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "info";
}) {
  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${metricToneClass(tone)}`}>
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold leading-tight tracking-normal">{value}</div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div>}
    </div>
  );
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
      anomalies.filter((anomaly) => anomaly.type === "longGap").sort((a, b) => (b.valueMin ?? 0) - (a.valueMin ?? 0)),
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
    <div
      ref={chartsRef}
      className="min-h-full space-y-4 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_34rem),linear-gradient(180deg,#020617_0%,#0f172a_46%,#020617_100%)] px-3.5 pb-6 pt-4 text-slate-100 sm:px-6"
    >
      <header className="rounded-[1.6rem] border border-slate-700/70 bg-slate-950/80 p-4 shadow-[0_22px_60px_rgba(2,6,23,0.42)] ring-1 ring-white/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-sky-300/80">TimeData</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-white">统计</h2>
          </div>
          {!atLatest && (
            <button
              type="button"
              onClick={() => setAnchor(today)}
              className="min-h-11 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 text-sm font-medium text-sky-100"
            >
              回到今天
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-950 p-1">
          {(["day", "week", "month"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`min-h-11 rounded-xl text-sm font-medium transition ${
                mode === m ? "bg-sky-500 text-white shadow-lg shadow-sky-950/40" : "text-slate-400"
              }`}
            >
              {{ day: "日", week: "周", month: "月" }[m]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            aria-label={`上一${periodUnit}`}
            onClick={() => setAnchor((current) => shiftStatsAnchor(mode, current, -1))}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-200"
          >
            ←
          </button>
          <label className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2">
            <span className="block truncate text-sm font-medium text-slate-100">{rangeLabel}</span>
            <input
              type="date"
              value={statsRange.fromDate}
              max={today}
              onChange={(event) => {
                if (event.target.value) setAnchor(event.target.value);
              }}
              className="mt-1 w-full bg-transparent text-sm text-slate-400 outline-none"
            />
          </label>
          <button
            type="button"
            aria-label={`下一${periodUnit}`}
            disabled={atLatest}
            onClick={() => setAnchor((current) => shiftStatsAnchor(mode, current, 1))}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-200 disabled:opacity-35"
          >
            →
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-sky-400/20 bg-sky-400/10 px-4 py-3">
          <div className="text-xs font-medium text-sky-200/80">已记录</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-semibold leading-none text-white">{totalHours.toFixed(1)}</span>
            <span className="pb-1 text-sm text-slate-300">小时</span>
          </div>
          {rangeClampedToToday && <div className="mt-2 text-xs text-slate-400">截至 {effectiveRange.toDate}</div>}
        </div>
      </header>

      <SectionPanel title="总览" eyebrow="Period">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="本周期总时长" value={`${overview.totalRecordedHours.toFixed(1)}h`} tone="info" />
          <MetricCard
            label="记录覆盖率"
            value={`${overview.coverageDisplayPct.toFixed(1)}%`}
            hint={overview.coverageNote}
          />
        </div>
        {compositionParents.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-slate-500">父分类 → 子分类构成</div>
            <CategoryCompositionBars parents={compositionParents} />
          </div>
        )}
        {pieData.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
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
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 py-10 text-center text-sm text-slate-500">
            暂无统计数据
          </div>
        )}
      </SectionPanel>

      <SectionPanel title="作息" eyebrow="Routine">
        {sleepCategoryId === null ? (
          <Link
            to="/settings/insights"
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm text-slate-300"
          >
            设置睡眠分类后可查看作息分析
            <span aria-hidden>›</span>
          </Link>
        ) : routine.sampleCount === 0 ? (
          <p className="text-sm text-slate-500">本周期暂无睡眠样本。</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <MetricCard label="平均入睡" value={formatClockFromMinute(routine.averageBedTimeMin)} />
              <MetricCard label="平均起床" value={formatClockFromMinute(routine.averageWakeTimeMin)} />
              <MetricCard label="平均睡眠" value={formatHoursFromMin(routine.averageDurationMin)} tone="good" />
            </div>
            <p className="text-xs text-slate-500">
              {routineStateText(routine.regularity.state)} · 样本 {routine.sampleCount} 天
              {routine.sleepWindow.source === "samples" &&
                ` · 通常睡眠时段 ${formatClockFromMinute(routine.sleepWindow.startMin)}~${formatClockFromMinute(routine.sleepWindow.endMin)}`}
            </p>
          </div>
        )}
      </SectionPanel>

      <SectionPanel
        title="异常与空挡"
        eyebrow="Attention"
        action={
          anomalies.length > 0 ? (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100">
              {anomalies.length} 项
            </span>
          ) : null
        }
      >
        {anomalies.length === 0 ? (
          <p className="text-sm text-slate-500">本周期未发现明显异常或长空挡。</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <MetricCard
                label="长空挡"
                value={anomalyStats.longGapCount}
                hint={`最长 ${formatDurationFromMin(anomalyStats.longestGapMin)}`}
                tone="warn"
              />
              <MetricCard
                label="空挡合计"
                value={formatDurationFromMin(anomalyStats.longGapTotalMin)}
                hint="超过个人阈值"
                tone="warn"
              />
              <MetricCard
                label="记录异常"
                value={anomalyStats.recordIssueCount}
                hint={`未记录日 ${anomalyStats.unrecordedDayCount}`}
                tone="danger"
              />
            </div>

            {longGapAnomalies.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-slate-500">长空挡 Top</div>
                <ul className="space-y-1.5">
                  {longGapAnomalies.slice(0, 5).map((anomaly, index) => (
                    <li
                      key={`top:${anomaly.date}:${anomaly.startTime ?? ""}:${anomaly.endTime ?? ""}:${index}`}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm"
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

            <details
              className="mt-4 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/40 px-3 py-2"
              open={mode !== "month"}
            >
              <summary className="min-h-10 cursor-pointer py-2 text-xs font-medium text-slate-400">按日期分布</summary>
              <div className="mt-2 space-y-2">
                {anomalyDateGroups.map((group) => (
                  <div key={group.date} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
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
                              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
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
      </SectionPanel>

      <SectionPanel title="趋势变化" eyebrow="Trend">
        <div className="flex flex-wrap items-center gap-2">
          {TREND_PRESETS.map((preset) => {
            const active = trendWindowSpec.kind === "preset" && trendWindowSpec.days === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                aria-pressed={active}
                onClick={() => setTrendWindowSpec({ kind: "preset", days: preset.days })}
                className={`min-h-10 rounded-full px-3 text-xs font-medium ${
                  active ? "bg-sky-500 text-white" : "border border-slate-800 bg-slate-900 text-slate-400"
                }`}
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
            className="min-h-10 w-28 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
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
            className="min-h-10 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
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
            className="min-h-10 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
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
                  className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm"
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
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3">
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
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3">
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
                className={`min-h-10 rounded-full px-3 text-xs font-medium ${
                  trendChart === "line"
                    ? "bg-sky-500 text-white"
                    : "border border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                折线
              </button>
              <button
                type="button"
                aria-pressed={trendChart === "area"}
                onClick={() => setTrendChart("area")}
                className={`min-h-10 rounded-full px-3 text-xs font-medium ${
                  trendChart === "area"
                    ? "bg-sky-500 text-white"
                    : "border border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                堆叠面积
              </button>
            </div>

            {chartsInView ? (
              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                <TrendChart chart={trendChart} data={trendChartData} series={trendSeries} />
              </div>
            ) : (
              <div className="min-h-[220px]" />
            )}
          </>
        )}
      </SectionPanel>

      <SectionPanel title="结构诊断" eyebrow="Structure">
        {structure.current.sessionCount === 0 ? (
          <p className="text-sm text-slate-500">本周期无足够会话用于结构诊断。</p>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 space-y-1">
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

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">碎片化（仅供观察，不报警）</div>
              <div className="text-slate-300 text-xs">
                每活跃小时切换 {structure.fragment.switchesPerActiveHour} 次（基线{" "}
                {structure.fragment.baselineSwitchesPerActiveHour}） · 短会话占比{" "}
                {structure.fragment.shortSessionRatioPct}%（基线 {structure.fragment.baselineShortSessionRatioPct}%）
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 space-y-1">
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
      </SectionPanel>
    </div>
  );
}
