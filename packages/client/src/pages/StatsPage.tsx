import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { getDateString } from "../lib/time.ts";
import { detectAnomalies } from "../lib/insights/anomalies.ts";
import { getSleepCategoryId, setSleepCategoryId } from "../lib/sleepCategorySetting.ts";

type ViewMode = StatsViewMode;

const ANOMALY_LABEL: Record<string, string> = {
  overlong: "超长记录",
  overnight: "跨午夜",
  sleepTimeActivity: "睡眠时段活动",
  longGap: "长空白",
  unrecordedDay: "未记录",
};

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
    </div>
  );
}
