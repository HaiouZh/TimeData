import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, computeSleepDuration } from "../../../lib/healthUtils.ts";
import { TrendChart } from "../InsightCharts.tsx";

export function SleepCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.healthSleep.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);

  const chartData = useMemo(
    () =>
      [...data]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => ({ date: s.date, 睡眠时长: Math.round(computeSleepDuration(s) * 10) / 10 })),
    [data],
  );

  if (data.length === 0) return <div className="health-card empty">暂无睡眠数据</div>;

  const latest = chartData[chartData.length - 1];

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">🌙</span>
        <h3>睡眠</h3>
        {latest != null && <span className="health-card-value">{latest.睡眠时长.toFixed(1)}h</span>}
      </div>
      <TrendChart
        chart="area"
        data={chartData}
        series={[{ key: "睡眠时长", color: "#818cf8" }]}
      />
    </div>
  );
}
