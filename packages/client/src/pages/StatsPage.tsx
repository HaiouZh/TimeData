import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { db } from "../db/index.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { buildStatsRangeForDate, summarizeEntriesByParentCategory, type StatsViewMode } from "../lib/stats.ts";
import { getDateString } from "../lib/time.ts";

type ViewMode = StatsViewMode;

export default function StatsPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [today, setToday] = useState(() => getDateString(new Date()));
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

  const statsRange = useMemo(() => buildStatsRangeForDate(mode, today), [mode, today]);

  const entries = useLiveQuery(
    async () => {
      const candidates = await db.timeEntries.where("endTime").above(statsRange.startUtc).toArray();
      return candidates.filter((entry) => entry.startTime < statsRange.endUtc);
    },
    [statsRange.startUtc, statsRange.endUtc]
  ) || [];

  const pieData = useMemo(
    () => summarizeEntriesByParentCategory(entries, categories, parentCategories, statsRange),
    [entries, categories, parentCategories, statsRange],
  );

  const totalHours = pieData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="p-4 space-y-6">
      <div className="flex gap-2">
        {(["day", "week", "month"] as ViewMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded text-sm ${mode === m ? "bg-blue-600" : "bg-slate-800 text-slate-400"}`}>
            {{ day: "日", week: "周", month: "月" }[m]}
          </button>
        ))}
      </div>
      <div className="text-center text-sm text-slate-400">已记录 {totalHours.toFixed(1)} 小时</div>
      {pieData.length > 0 && (
        <div className="flex justify-center">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name} ${value}h`}>
                {pieData.map((d, i) => (<Cell key={i} fill={d.color} />))}
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
            <Bar dataKey="value">{pieData.map((d, i) => (<Cell key={i} fill={d.color} />))}</Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {pieData.length === 0 && <div className="text-center text-slate-500 py-12">暂无数据</div>}
    </div>
  );
}
