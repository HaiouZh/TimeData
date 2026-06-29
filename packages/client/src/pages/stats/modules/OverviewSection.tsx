import { useMemo } from "react";
import { memoOverview } from "../../../lib/insights/cache.ts";
import { CategoryCompositionBars, CategoryDonut, type CompositionParent } from "../InsightCharts.tsx";
import type { StatsModuleProps } from "./types.ts";
import { MetricCard, SectionPanel } from "./ui.tsx";

export default function OverviewSection(props: StatsModuleProps) {
  const overview = useMemo(
    () =>
      memoOverview({
        entries: props.entries,
        categories: props.categories,
        fromDate: props.effectiveRange.fromDate,
        toDate: props.effectiveRange.toDate,
        sleepCategoryId: props.sleepCategoryId,
      }),
    [
      props.entries,
      props.categories,
      props.effectiveRange.fromDate,
      props.effectiveRange.toDate,
      props.sleepCategoryId,
    ],
  );

  const pieData = useMemo(
    () =>
      overview.parents.map((parent) => ({
        id: parent.parentId,
        name: parent.name,
        value: parent.totalHours,
        color: parent.color,
      })),
    [overview],
  );

  const compositionParents = useMemo<CompositionParent[]>(
    () =>
      overview.parents.map((parent) => ({
        id: parent.parentId,
        name: parent.name,
        totalHours: parent.totalHours,
        sharePct: parent.sharePct,
        color: parent.color,
        children: parent.children.map((child) => ({
          id: child.categoryId,
          name: child.name,
          min: child.totalMin,
          color: child.color,
        })),
      })),
    [overview],
  );

  return (
    <SectionPanel title="总览" eyebrow="Period">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="本周期总时长" value={`${overview.totalRecordedHours.toFixed(1)}h`} tone="info" />
        <MetricCard
          label="记录覆盖率"
          value={`${overview.coverageDisplayPct.toFixed(1)}%`}
          hint={overview.coverageNote}
        />
      </div>
      {compositionParents.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-ink-3">父分类 → 子分类构成</div>
          <CategoryCompositionBars parents={compositionParents} />
        </div>
      )}
      {pieData.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface-elevated">
          <CategoryDonut
            data={pieData}
            totalHours={overview.totalRecordedHours}
            coveragePct={overview.coverageDisplayPct}
            coverageNote={overview.coverageNote}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-card border border-dashed border-border bg-surface-elevated py-10 text-center text-sm text-ink-3">
          暂无统计数据
        </div>
      )}
    </SectionPanel>
  );
}
