import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, computeRollingAverage } from "../../../lib/healthUtils.ts";
import { TrendChart } from "../InsightCharts.tsx";

export function StressCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.healthStress.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);
  const rolling = useMemo(() => computeRollingAverage(data, "stress", 7), [data]);

  if (data.length === 0) return <div className="health-card empty">暂无压力数据</div>;

  const latest = data[data.length - 1];
  const chartData = rolling.map((r) => ({ date: r.date, 压力: r.value ?? 0, "7日均值": r.avg ?? 0 }));

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">🧠</span>
        <h3>压力</h3>
        {latest?.stress != null && <span className="health-card-value">{latest.stress}</span>}
      </div>
      <TrendChart
        chart="line"
        data={chartData}
        series={[{ key: "压力", color: "#fbbf24" }, { key: "7日均值", color: "#fbbf2466" }]}
      />
    </div>
  );
}
