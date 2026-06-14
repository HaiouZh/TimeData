import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, computeRollingAverage } from "../../../lib/healthUtils.ts";
import { TrendChart } from "../InsightCharts.tsx";

export function HrvCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.healthHrv.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);
  const rolling = useMemo(() => computeRollingAverage(data, "hrvMs", 7), [data]);

  if (data.length === 0) return <div className="health-card empty">暂无 HRV 数据</div>;

  const latest = data[data.length - 1];
  const chartData = rolling.map((r) => ({ date: r.date, HRV: r.value ?? 0, "7日均值": r.avg ?? 0 }));

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">💚</span>
        <h3>心率变异性 (HRV)</h3>
        {latest?.hrvMs != null && <span className="health-card-value">{latest.hrvMs} ms</span>}
      </div>
      <TrendChart
        chart="line"
        data={chartData}
        series={[{ key: "HRV", color: "#4ade80" }, { key: "7日均值", color: "#4ade8066" }]}
      />
    </div>
  );
}
