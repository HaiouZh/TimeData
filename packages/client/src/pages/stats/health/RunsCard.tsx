import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, formatDuration } from "../../../lib/healthUtils.ts";

export function RunsCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.runs.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);

  const sorted = useMemo(() => [...data].sort((a, b) => b.date.localeCompare(a.date)), [data]);
  const totalDistance = useMemo(
    () => sorted.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0),
    [sorted],
  );

  if (data.length === 0) return <div className="health-card empty">暂无跑步数据</div>;

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">🏃</span>
        <h3>跑步</h3>
      </div>
      <div className="run-summary">
        <div className="run-summary-item">
          <span className="run-summary-label">总次数</span>
          <span className="run-summary-value">{sorted.length}</span>
        </div>
        <div className="run-summary-item">
          <span className="run-summary-label">总距离</span>
          <span className="run-summary-value">{totalDistance.toFixed(1)} km</span>
        </div>
      </div>
      <div className="runs-list">
        {sorted.map((run) => (
          <div key={run.id} className="run-item">
            <span className="run-date">{run.date}</span>
            <span className="run-distance">{run.distanceKm?.toFixed(1) ?? "--"} km</span>
            <span className="run-pace">{formatPace(run.durationSeconds, run.distanceKm)}</span>
            <span className="run-hr">{run.averageHeartRate != null ? `${run.averageHeartRate} bpm` : "--"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
