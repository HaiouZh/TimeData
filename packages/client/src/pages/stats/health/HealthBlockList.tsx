import type { ComponentProps } from "react";
import type { HealthChartConfig } from "@timedata/shared";
import type { ChartSeriesRange, HealthMetricCollections } from "../../../lib/healthMetrics/index.ts";
import { HealthSummaryCards, type HealthSummaryCardItem } from "./HealthSummaryCards.tsx";
import { MetricChartBlock } from "./MetricChartBlock.tsx";
import { RunPaceTrendChart } from "./RunPaceTrendChart.tsx";

export function HealthBlockList({
  blocks,
  collections,
  range,
  summaryItems,
  runPace,
  onEdit,
  onDelete,
}: {
  blocks: HealthChartConfig[];
  collections: HealthMetricCollections;
  range: ChartSeriesRange;
  summaryItems: HealthSummaryCardItem[];
  runPace: ComponentProps<typeof RunPaceTrendChart>["data"];
  onEdit: (block: HealthChartConfig) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="health-block-list">
      {blocks.map((block) => (
        <div key={block.id} className="health-block">
          <div className="health-block-actions">
            {block.type === "metricChart" && (
              <button type="button" className="health-block-edit" aria-label="编辑图表" onClick={() => onEdit(block)}>
                编辑
              </button>
            )}
            <button type="button" className="health-block-delete" aria-label="删除图表" onClick={() => onDelete(block.id)}>
              删除
            </button>
          </div>
          {block.type === "metricChart" && <MetricChartBlock config={block} collections={collections} range={range} />}
          {block.type === "runTrend" && <RunPaceTrendChart data={runPace} />}
          {block.type === "summary" && (
            <section className="health-summary-block" aria-label={block.title}>
              <div className="health-panel-header">
                <h3 className="health-panel-title">{block.title}</h3>
              </div>
              <HealthSummaryCards items={summaryItems} />
            </section>
          )}
        </div>
      ))}
    </div>
  );
}
