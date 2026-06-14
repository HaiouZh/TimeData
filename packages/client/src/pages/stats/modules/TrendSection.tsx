import { localDateTimeToUtc } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { memoTrend } from "../../../lib/insights/cache.ts";
import { type ParentTrend, type TrendPoint, resolveTrendWindow } from "../../../lib/insights/trends.ts";
import { useTrendConfig } from "../../../lib/statsModuleTrendSetting.ts";
import { addDays } from "../../../lib/time.ts";
import { TrendChart, type TrendChartKind, type TrendChartRow } from "../InsightCharts.tsx";
import type { StatsModuleProps } from "./types.ts";
import { SectionPanel } from "./ui.tsx";

const TREND_PRESETS: { days: number; label: string }[] = [
  { days: 7, label: "近7天" },
  { days: 30, label: "近30天" },
  { days: 90, label: "近90天" },
];

const TIME_AREA_Y_AXIS_DOMAIN: [number, number] = [0, 24];
const TIME_AREA_Y_AXIS_TICKS = [0, 6, 12, 18, 24];

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

export function buildTrendChartRows(
  points: TrendPoint[],
  parentTrends: ParentTrend[],
  parentNameById: Map<string, string>,
): TrendChartRow[] {
  return points.map((point) => {
    const row: TrendChartRow = { date: point.date.slice(5) };
    for (const trend of parentTrends) {
      row[parentNameById.get(trend.parentId) ?? trend.parentId] = (point.byParent[trend.parentId] ?? 0) / 60;
    }
    return row;
  });
}

export default function TrendSection(props: StatsModuleProps) {
  const { config, setConfig } = useTrendConfig();
  const trendWindowSpec = config.window;
  const trendChart = config.chart;

  const trendWindow = useMemo(() => resolveTrendWindow(trendWindowSpec, props.today), [trendWindowSpec, props.today]);
  const trendWithinBaseline = trendWindow.prevFrom >= props.baselineFrom;
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
    return props.baselineEntries.filter((entry) => entry.endTime > startUtc && entry.startTime < endUtc);
  }, [trendWithinBaseline, trendFallback, props.baselineEntries, trendWindow.prevFrom, trendWindow.to]);

  const trend = useMemo(
    () => memoTrend(trendEntries, props.categories, trendWindow),
    [trendEntries, props.categories, trendWindow],
  );

  const trendChartData = useMemo(
    () => buildTrendChartRows(trend.points, trend.parentTrends, props.parentNameById),
    [trend, props.parentNameById],
  );
  const trendSeries = useMemo(
    () =>
      trend.parentTrends.map((t) => ({
        key: props.parentNameById.get(t.parentId) ?? t.parentId,
        color: props.parentCategories.find((category) => category.id === t.parentId)?.color ?? "#808080",
      })),
    [trend, props.parentNameById, props.parentCategories],
  );

  const setWindow = (window: typeof trendWindowSpec) => setConfig({ ...config, window });
  const setChart = (chart: TrendChartKind) => setConfig({ ...config, chart });

  return (
    <SectionPanel title="趋势变化" eyebrow="Trend">
      <div className="flex flex-wrap items-center gap-2">
        {TREND_PRESETS.map((preset) => {
          const active = trendWindowSpec.kind === "preset" && trendWindowSpec.days === preset.days;
          return (
            <button
              key={preset.days}
              type="button"
              aria-pressed={active}
              onClick={() => setWindow({ kind: "preset", days: preset.days })}
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
            if (Number.isFinite(days) && days >= 1) setWindow({ kind: "customDays", days });
          }}
          className="min-h-10 w-28 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
        />
        <span className="text-xs text-slate-500">或</span>
        <input
          type="date"
          max={props.today}
          aria-label="趋势起始日"
          value={trendWindowSpec.kind === "customRange" ? trendWindowSpec.from : ""}
          onChange={(event) => {
            const from = event.target.value;
            if (from) {
              const to = trendWindowSpec.kind === "customRange" ? trendWindowSpec.to : props.today;
              setWindow({ kind: "customRange", from, to: to < from ? from : to });
            }
          }}
          className="min-h-10 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
        />
        <input
          type="date"
          max={props.today}
          aria-label="趋势结束日"
          value={trendWindowSpec.kind === "customRange" ? trendWindowSpec.to : ""}
          onChange={(event) => {
            const to = event.target.value;
            if (to) {
              const from = trendWindowSpec.kind === "customRange" ? trendWindowSpec.from : to;
              setWindow({ kind: "customRange", from: from > to ? to : from, to });
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
                <span className="text-slate-200">{props.parentNameById.get(t.parentId) ?? t.parentId}</span>
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
                <div className="mb-1 text-slate-400">上升最多</div>
                {trend.topRising.length === 0 ? (
                  <div className="text-slate-600">—</div>
                ) : (
                  trend.topRising.map((t) => (
                    <div key={t.parentId} className="text-emerald-400">
                      {props.parentNameById.get(t.parentId) ?? t.parentId} ↑{t.deltaPct}%
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3">
                <div className="mb-1 text-slate-400">下降最多</div>
                {trend.topFalling.length === 0 ? (
                  <div className="text-slate-600">—</div>
                ) : (
                  trend.topFalling.map((t) => (
                    <div key={t.parentId} className="text-rose-400">
                      {props.parentNameById.get(t.parentId) ?? t.parentId} ↓{Math.abs(t.deltaPct ?? 0)}%
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
              onClick={() => setChart("line")}
              className={`min-h-10 rounded-full px-3 text-xs font-medium ${
                trendChart === "line" ? "bg-sky-500 text-white" : "border border-slate-800 bg-slate-900 text-slate-400"
              }`}
            >
              折线
            </button>
            <button
              type="button"
              aria-pressed={trendChart === "area"}
              onClick={() => setChart("area")}
              className={`min-h-10 rounded-full px-3 text-xs font-medium ${
                trendChart === "area" ? "bg-sky-500 text-white" : "border border-slate-800 bg-slate-900 text-slate-400"
              }`}
            >
              堆叠面积
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
            <TrendChart
              chart={trendChart}
              data={trendChartData}
              series={trendSeries}
              yAxisDomain={trendChart === "area" ? TIME_AREA_Y_AXIS_DOMAIN : undefined}
              yAxisTicks={trendChart === "area" ? TIME_AREA_Y_AXIS_TICKS : undefined}
            />
          </div>
        </>
      )}
    </SectionPanel>
  );
}
