import type { HealthChartConfig } from "@timedata/shared";
import {
  buildHealthSummaryCardItems,
  filterCollectionsByRange,
  filterSummaryCardItems,
  resolveBlockRange,
} from "../../../lib/healthBlocks/index.ts";
import type { ChartSeriesRange, HealthMetricCollections } from "../../../lib/healthMetrics/index.ts";
import { HealthSummaryCards, type HealthSummaryCardItem } from "./HealthSummaryCards.tsx";
import { MetricChartBlock } from "./MetricChartBlock.tsx";
import { MetricTableBlock } from "./MetricTableBlock.tsx";
import { RunTableBlock } from "./RunTableBlock.tsx";

export function HealthBlockList({
  blocks,
  collections,
  range,
  summaryItems,
  onEdit,
  onDelete,
}: {
  blocks: HealthChartConfig[];
  collections: HealthMetricCollections;
  range: ChartSeriesRange;
  summaryItems: HealthSummaryCardItem[];
  onEdit: (block: HealthChartConfig) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="health-block-list">
      {blocks.map((block) => (
        <div key={block.id} className="health-block">
          <div className="health-block-actions">
            <button type="button" className="health-block-edit" aria-label="编辑图表" onClick={() => onEdit(block)}>
              编辑
            </button>
            <button type="button" className="health-block-delete" aria-label="删除图表" onClick={() => onDelete(block.id)}>
              删除
            </button>
          </div>
          {block.view === "chart" && block.source === "healthMetricDaily" && (
            <MetricChartBlock config={block} collections={collections} range={resolveBlockRange(block.range, range)} />
          )}
          {block.view === "table" && block.source === "healthMetricDaily" && (
            <MetricTableBlock config={block} collections={collections} range={resolveBlockRange(block.range, range)} />
          )}
          {block.view === "table" && block.source === "runs" && (
            <RunTableBlock config={block} runs={collections.runs ?? []} range={resolveBlockRange(block.range, range)} />
          )}
          {block.view === "stat" && block.source === "derived" && (
            <section className="health-summary-block" aria-label={block.title}>
              <div className="health-panel-header">
                <h3 className="health-panel-title">{block.title}</h3>
              </div>
              <HealthSummaryCards
                items={
                  block.range.mode === "inherit"
                    ? filterSummaryCardItems(summaryItems, block.metricIds)
                    : buildHealthSummaryCardItems(filterCollectionsByRange(collections, resolveBlockRange(block.range, range)), block.metricIds)
                }
              />
            </section>
          )}
        </div>
      ))}
    </div>
  );
}
