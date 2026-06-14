import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../../../db/index.ts";
import { filterByDateRange, formatDuration, formatPace } from "../../../lib/healthUtils.ts";
import { useSetting } from "../../../lib/settings/index.ts";
import { TrendChart } from "../InsightCharts.tsx";

export function RunsCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.runs.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);

  const sorted = useMemo(() => [...data].sort((a, b) => b.date.localeCompare(a.date)), [data]);
  const totalDistance = useMemo(
    () => sorted.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0),
    [sorted],
  );

  const showTrendSetting = useSetting("health.runs.showTrend");
  const expandDetailSetting = useSetting("health.runs.expandDetail");
  const showTrend = showTrendSetting !== "false";
  const defaultExpand = expandDetailSetting === "true";

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chartData = useMemo(
    () =>
      [...data]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, 距离: r.distanceKm ?? 0 })),
    [data],
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

      {showTrend && chartData.length > 1 && (
        <TrendChart
          chart="line"
          data={chartData}
          series={[{ key: "距离", color: "#4fc3f7" }]}
          yAxisUnit="km"
          tooltipSuffix="公里"
        />
      )}

      <div className="runs-list">
        {sorted.map((run) => {
          const isExpanded = defaultExpand || expandedIds.has(run.id);
          return (
            <div key={run.id} className="run-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <button
                type="button"
                onClick={() => toggleExpand(run.id)}
                aria-expanded={isExpanded}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  width: "100%",
                  background: "none",
                  border: "none",
                  color: "inherit",
                  font: "inherit",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                <span className="run-date">{run.date}</span>
                <span className="run-distance">{run.distanceKm?.toFixed(1) ?? "--"} km</span>
                <span className="run-pace">{formatPace(run.durationSeconds, run.distanceKm)}</span>
                <span className="run-hr">
                  {run.averageHeartRate != null ? `${run.averageHeartRate} bpm` : "--"}
                </span>
                <span style={{ fontSize: "0.7rem", color: "#94a3b8", marginLeft: "auto" }}>
                  {isExpanded ? "▲" : "▼"}
                </span>
              </button>

              {isExpanded && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.35rem 1rem",
                    marginTop: "0.5rem",
                    padding: "0.5rem",
                    borderRadius: "0.5rem",
                    background: "rgba(15, 23, 42, 0.5)",
                    fontSize: "0.8rem",
                    color: "#cbd5e1",
                  }}
                >
                  <DetailItem label="开始时间" value={run.startTime} />
                  <DetailItem label="时长" value={formatDuration(run.durationSeconds)} />
                  <DetailItem
                    label="步频"
                    value={run.averageCadence != null ? `${run.averageCadence.toFixed(1)} spm` : "--"}
                  />
                  <DetailItem
                    label="步幅"
                    value={run.averageStrideM != null ? `${run.averageStrideM.toFixed(2)} m` : "--"}
                  />
                  <DetailItem
                    label="触地时间"
                    value={
                      run.averageGroundContactMs != null ? `${run.averageGroundContactMs} ms` : "--"
                    }
                  />
                  <DetailItem
                    label="垂直振幅"
                    value={
                      run.averageVerticalOscillationCm != null
                        ? `${run.averageVerticalOscillationCm.toFixed(1)} cm`
                        : "--"
                    }
                  />
                  <DetailItem
                    label="垂直比"
                    value={
                      run.averageVerticalRatioPercent != null
                        ? `${run.averageVerticalRatioPercent.toFixed(2)}%`
                        : "--"
                    }
                  />
                  <DetailItem label="城市" value={run.city || "--"} />
                  <DetailItem label="类型" value={run.type || "--"} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
