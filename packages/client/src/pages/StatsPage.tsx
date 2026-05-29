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

type ViewMode = StatsViewMode;

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
          aria-label="上一周期"
          onClick={() => setAnchor((current) => shiftStatsAnchor(mode, current, -1))}
          className="px-3 py-1.5 rounded text-sm bg-slate-800 text-slate-300"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-200">{rangeLabel}</span>
          <input
            type="date"
            value={anchor}
            max={today}
            onChange={(event) => {
              if (event.target.value) setAnchor(event.target.value);
            }}
            className="bg-slate-800 text-slate-300 text-sm rounded px-2 py-1"
          />
        </div>
        <button
          type="button"
          aria-label="下一周期"
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
    </div>
  );
}
