import { localDateTimeToUtc } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../db/index.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { memoOverview } from "../lib/insights/cache.ts";
import { INSIGHT_CONSTANTS } from "../lib/insights/constants.ts";
import { useSleepCategoryId } from "../lib/sleepCategorySetting.ts";
import {
  buildStatsRangeForDate,
  formatStatsRangeLabel,
  isLatestPeriod,
  type StatsViewMode,
  shiftStatsAnchor,
} from "../lib/stats.ts";
import { useStatsLayout } from "../lib/statsLayoutSetting.ts";
import { addDays, getDateString } from "../lib/time.ts";
import { STATS_MODULE_LIST, STATS_MODULES } from "./stats/modules/statsModules.ts";
import type { StatsModuleProps } from "./stats/modules/types.ts";

type ViewMode = StatsViewMode;

export default function StatsPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [today, setToday] = useState(() => getDateString(new Date()));
  const [anchor, setAnchor] = useState(() => getDateString(new Date()));
  const { parentCategories, categories } = useCategories();
  const layout = useStatsLayout(STATS_MODULE_LIST);

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
  const needBaseline = useMemo(
    () => layout.visibleModulesInOrder.some((id) => STATS_MODULES[id].needs?.baseline),
    [layout.visibleModulesInOrder],
  );

  const baselineEntries =
    useLiveQuery(async () => {
      if (!needBaseline) return [];
      const startUtc = localDateTimeToUtc(`${baselineFrom}T00:00:00`);
      const endUtc = localDateTimeToUtc(`${addDays(today, 1)}T00:00:00`);
      const candidates = await db.timeEntries.where("endTime").above(startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < endUtc);
    }, [needBaseline, baselineFrom, today]) || [];

  const periodWithinBaseline = effectiveRange.fromDate >= baselineFrom;
  const periodFallback =
    useLiveQuery(async () => {
      if (needBaseline && periodWithinBaseline) return [];
      const candidates = await db.timeEntries.where("endTime").above(effectiveRange.startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < effectiveRange.endUtc);
    }, [needBaseline, periodWithinBaseline, effectiveRange.startUtc, effectiveRange.endUtc]) || [];

  const entries = useMemo(() => {
    if (!needBaseline || !periodWithinBaseline) return periodFallback;
    return baselineEntries.filter(
      (entry) => entry.endTime > effectiveRange.startUtc && entry.startTime < effectiveRange.endUtc,
    );
  }, [
    needBaseline,
    periodWithinBaseline,
    periodFallback,
    baselineEntries,
    effectiveRange.startUtc,
    effectiveRange.endUtc,
  ]);

  const parentNameById = useMemo(
    () => new Map(parentCategories.map((category) => [category.id, category.name])),
    [parentCategories],
  );
  const sleepCategoryId = useSleepCategoryId();
  // 头部「已记录」与「总览」卡片复用同一份 memoOverview，保证两处总时长完全一致（同 key 命中缓存，不重复计算）。
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
  const totalHours = overview.totalRecordedHours;

  const moduleContext = useMemo<StatsModuleProps>(
    () => ({
      mode,
      today,
      effectiveRange,
      baselineFrom,
      entries,
      baselineEntries,
      categories,
      parentCategories,
      parentNameById,
      sleepCategoryId,
    }),
    [
      mode,
      today,
      effectiveRange,
      baselineFrom,
      entries,
      baselineEntries,
      categories,
      parentCategories,
      parentNameById,
      sleepCategoryId,
    ],
  );

  return (
    <div className="min-h-full space-y-4 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_34rem),linear-gradient(180deg,#020617_0%,#0f172a_46%,#020617_100%)] px-3.5 pb-6 pt-4 text-slate-100 sm:px-6">
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

      {layout.visibleModulesInOrder.length === 0 ? (
        <div className="rounded-[1.35rem] border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
          所有统计模块已隐藏。
          <Link to="/settings/stats-layout" className="ml-1 text-sky-300 underline">
            去设置启用
          </Link>
        </div>
      ) : (
        layout.visibleModulesInOrder.map((id) => {
          const Module = STATS_MODULES[id].component;
          return <Module key={id} {...moduleContext} />;
        })
      )}
    </div>
  );
}
