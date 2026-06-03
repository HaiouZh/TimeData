import { useMemo } from "react";
import { Link } from "react-router-dom";
import { memoRoutine } from "../../../lib/insights/cache.ts";
import { type buildRoutineInsights, formatClockFromMinute } from "../../../lib/insights/routine.ts";
import type { StatsModuleProps } from "./types.ts";
import { MetricCard, SectionPanel } from "./ui.tsx";

function formatHoursFromMin(minutes: number | null): string {
  if (minutes === null) return "--";
  return `${(minutes / 60).toFixed(1)}h`;
}

function routineStateText(state: ReturnType<typeof buildRoutineInsights>["regularity"]["state"]): string {
  if (state === "stable") return "作息较稳定";
  if (state === "variable") return "作息波动较大";
  if (state === "insufficientSamples") return "样本不足，仅展示原始指标";
  if (state === "noSamples") return "暂无睡眠样本";
  return "未配置睡眠分类";
}

export default function RoutineSection(props: StatsModuleProps) {
  const routine = useMemo(
    () =>
      memoRoutine({
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

  return (
    <SectionPanel title="作息" eyebrow="Routine">
      {props.sleepCategoryId === null ? (
        <Link
          to="/settings/insights"
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm text-slate-300"
        >
          设置睡眠分类后可查看作息分析
          <span aria-hidden>›</span>
        </Link>
      ) : routine.sampleCount === 0 ? (
        <p className="text-sm text-slate-500">本周期暂无睡眠样本。</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <MetricCard label="平均入睡" value={formatClockFromMinute(routine.averageBedTimeMin)} />
            <MetricCard label="平均起床" value={formatClockFromMinute(routine.averageWakeTimeMin)} />
            <MetricCard label="平均睡眠" value={formatHoursFromMin(routine.averageDurationMin)} tone="good" />
          </div>
          <p className="text-xs text-slate-500">
            {routineStateText(routine.regularity.state)} · 样本 {routine.sampleCount} 天
            {routine.sleepWindow.source === "samples" &&
              ` · 通常睡眠时段 ${formatClockFromMinute(routine.sleepWindow.startMin)}~${formatClockFromMinute(routine.sleepWindow.endMin)}`}
          </p>
        </div>
      )}
    </SectionPanel>
  );
}
