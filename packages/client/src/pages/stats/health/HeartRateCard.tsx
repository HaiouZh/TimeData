import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, computeRollingAverage } from "../../../lib/healthUtils.ts";
import { TrendChart } from "../InsightCharts.tsx";

export function HeartRateCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.healthHeartRate.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);
  const rolling = useMemo(() => computeRollingAverage(data, "restingHeartRate", 7), [data]);

  if (data.length === 0) return <div className="health-card empty">暂无心率数据</div>;

  const latest = data[data.length - 1];
  const chartData = rolling.map((r) => ({ date: r.date, 静息心率: r.value ?? 0, "7日均值": r.avg ?? 0 }));

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">❤️</span>
        <h3>静息心率</h3>
        {latest?.restingHeartRate != null && <span className="health-card-value">{latest.restingHeartRate} bpm</span>}
      </div>
      <TrendChart
        chart="line"
        data={chartData}
        series={[{ key: "静息心率", color: "#ef5350" }, { key: "7日均值", color: "#ef535066" }]}
      />
    </div>
  );
}
