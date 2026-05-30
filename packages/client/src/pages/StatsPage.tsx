import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { localDateTimeToUtc } from "@timedata/shared";
import { db } from "../db/index.ts";
import { useCategories } from "../hooks/useCategories.ts";
import {
  type StatsViewMode,
  buildStatsRangeForDate,
  formatStatsRangeLabel,
  isLatestPeriod,
  shiftStatsAnchor,
  summarizeEntriesByParentCategory,
} from "../lib/stats.ts";
import { addDays, getDateString } from "../lib/time.ts";
import { detectAnomalies } from "../lib/insights/anomalies.ts";
import { getSleepCategoryId, setSleepCategoryId } from "../lib/sleepCategorySetting.ts";
import { type ParentTrend, type TrendWindowSpec, buildTrend, resolveTrendWindow } from "../lib/insights/trends.ts";
import { INSIGHT_CONSTANTS } from "../lib/insights/constants.ts";
import { buildStructure } from "../lib/insights/structure.ts";

type ViewMode = StatsViewMode;

const ANOMALY_LABEL: Record<string, string> = {
  overlong: "超长记录",
  overnight: "跨午夜",
  sleepTimeActivity: "睡眠时段活动",
  longGap: "长空白",
  unrecordedDay: "未记录",
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

export default function StatsPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [today, setToday] = useState(() => getDateString(new Date()));
  const [anchor, setAnchor] = useState(() => getDateString(new Date()));
  const { parentCategories, categories } = useCategories();

  useEffect(() => {
    const refreshToday = () => setToday(getDateString(new Date()));
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
  const atLatest = isLatestPeriod(mode, anchor, today);
  const rangeLabel = formatStatsRangeLabel(mode, statsRange);
  const periodUnit = { day: "天", week: "周", month: "月" }[mode];

  const entries =
    useLiveQuery(async () => {
      const candidates = await db.timeEntries.where("endTime").above(statsRange.startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < statsRange.endUtc);
    }, [statsRange.startUtc, statsRange.endUtc]) || [];

  const pieData = useMemo(
    () => summarizeEntriesByParentCategory(entries, categories, parentCategories, statsRange),
    [entries, categories, parentCategories, statsRange],
  );

  const totalHours = pieData.reduce((sum, d) => sum + d.value, 0);

  const [sleepCategoryId, setSleepCategoryIdState] = useState<string | null>(() => getSleepCategoryId());

  const anomalies = useMemo(
    () =>
      detectAnomalies({
        entries,
        categories,
        fromDate: statsRange.fromDate,
        toDate: statsRange.toDate,
        sleepCategoryId,
      }),
    [entries, categories, statsRange.fromDate, statsRange.toDate, sleepCategoryId],
  );

  const [trendWindowSpec, setTrendWindowSpec] = useState<TrendWindowSpec>({ kind: "preset", days: 7 });
  const [trendChart, setTrendChart] = useState<"line" | "area">("line");

  const trendWindow = useMemo(() => resolveTrendWindow(trendWindowSpec, today), [trendWindowSpec, today]);

  const trendEntries =
    useLiveQuery(async () => {
      const startUtc = localDateTimeToUtc(`${trendWindow.prevFrom}T00:00:00`);
      const endUtc = localDateTimeToUtc(`${addDays(trendWindow.to, 1)}T00:00:00`);
      const candidates = await db.timeEntries.where("endTime").above(startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < endUtc);
    }, [trendWindow.prevFrom, trendWindow.to]) || [];

  const trend = useMemo(
    () => buildTrend(trendEntries, categories, trendWindow, {}),
    [trendEntries, categories, trendWindow],
  );

  // 折线/面积图行数据：每行一天，键为父分类名，值为小时。
  const parentNameById = useMemo(() => new Map(parentCategories.map((c) => [c.id, c.name])), [parentCategories]);
  const trendChartData = useMemo(
    () =>
      trend.points.map((point) => {
        const row: Record<string, number | string> = { date: point.date.slice(5) };
        for (const t of trend.parentTrends) {
          row[parentNameById.get(t.parentId) ?? t.parentId] = Math.round(((point.byParent[t.parentId] ?? 0) / 60) * 10) / 10;
        }
        return row;
      }),
    [trend, parentNameById],
  );
  const trendSeries = useMemo(
    () => trend.parentTrends.map((t) => ({ key: parentNameById.get(t.parentId) ?? t.parentId, color: parentCategories.find((c) => c.id === t.parentId)?.color ?? "#808080" })),
    [trend, parentNameById, parentCategories],
  );

  const baselineFrom = useMemo(() => addDays(today, -(INSIGHT_CONSTANTS.baselineWindowDays - 1)), [today]);

  const baselineEntries =
    useLiveQuery(async () => {
      const startUtc = localDateTimeToUtc(`${baselineFrom}T00:00:00`);
      const endUtc = localDateTimeToUtc(`${addDays(today, 1)}T00:00:00`);
      const candidates = await db.timeEntries.where("endTime").above(startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < endUtc);
    }, [baselineFrom, today]) || [];

  const structure = useMemo(
    () =>
      buildStructure({
        periodEntries: entries,
        baselineEntries,
        categories,
        periodFrom: statsRange.fromDate,
        periodTo: statsRange.toDate,
        baselineFrom,
        baselineTo: today,
        sleepCategoryId,
      }),
    [entries, baselineEntries, categories, statsRange.fromDate, statsRange.toDate, baselineFrom, today, sleepCategoryId],
  );

  return (
    <div className="p-4 space-y-6">
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
      <div className="text-center text-sm text-slate-400">已记录 {totalHours.toFixed(1)} 小时</div>
      {pieData.length > 0 && (
        <div className="flex justify-center">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, value }) => `${name} ${value}h`}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} 小时`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      {pieData.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={pieData} layout="vertical">
            <XAxis type="number" unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={60} tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip formatter={(value) => `${value} 小时`} />
            <Bar dataKey="value">
              {pieData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {pieData.length === 0 && <div className="text-center text-slate-500 py-12">暂无统计数据</div>}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-200">异常与空档</h3>
          <select
            aria-label="睡眠分类"
            value={sleepCategoryId ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setSleepCategoryId(value);
              setSleepCategoryIdState(value);
            }}
            className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1"
          >
            <option value="">睡眠分类：未指定</option>
            {parentCategories.map((category) => (
              <option key={category.id} value={category.id}>
                睡眠：{category.name}
              </option>
            ))}
          </select>
        </div>
        {sleepCategoryId === null && (
          <p className="text-xs text-slate-500">指定「睡眠」分类后，超长记录与异常时段判定会更准确。</p>
        )}
        {anomalies.length === 0 ? (
          <p className="text-sm text-slate-500">本周期未发现异常。</p>
        ) : (
          <ul className="space-y-2">
            {anomalies.map((anomaly, index) => (
              <li key={index} className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200">
                <span className="mr-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                  {ANOMALY_LABEL[anomaly.type] ?? anomaly.type}
                </span>
                {anomaly.message}
              </li>
            ))}
          </ul>
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
                <li key={t.parentId} className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-1.5 text-sm">
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

            <ResponsiveContainer width="100%" height={220}>
              {trendChart === "line" ? (
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <Tooltip formatter={(value) => `${value} 小时`} />
                  <Legend />
                  {trendSeries.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} dot={false} />
                  ))}
                </LineChart>
              ) : (
                <AreaChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <Tooltip formatter={(value) => `${value} 小时`} />
                  <Legend />
                  {trendSeries.map((s) => (
                    <Area key={s.key} type="monotone" dataKey={s.key} stackId="1" stroke={s.color} fill={s.color} />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
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
                深度块 {structure.current.deepBlockCount} 个 · 深度门槛 ≥ {Math.round(structure.thresholds.deepThresholdMin)}min ·
                中位会话 {structure.current.medianSessionMin}min（基线 {structure.baseline.medianSessionMin}min）
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">碎片化（仅供观察，不报警）</div>
              <div className="text-slate-300 text-xs">
                每活跃小时切换 {structure.fragment.switchesPerActiveHour} 次（基线 {structure.fragment.baselineSwitchesPerActiveHour}）
                · 短会话占比 {structure.fragment.shortSessionRatioPct}%（基线 {structure.fragment.baselineShortSessionRatioPct}%）
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200 space-y-1">
              <div className="text-slate-400 text-xs">投入分散度（香农熵）</div>
              <div className="text-slate-300 text-xs">
                {structure.entropy.normalizedPct}%（H={structure.entropy.entropyBits} / {structure.entropy.parentCount} 类）·
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
                        {item.currentSharePct}%，{item.direction === "high" ? "高于" : "低于"}你的常态
                        （{item.baselineMeanPct}%±{item.baselineStdevPct}%）
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
