import { CaretRight } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Icon } from "../../../components/Icon.js";
import { memoRoutine } from "../../../lib/insights/cache.ts";
import { formatClockFromMinute, type RoutineRegularityState } from "../../../lib/insights/routine.ts";
import type { StatsModuleProps } from "./types.ts";
import { MetricCard, SectionPanel } from "./ui.tsx";

function formatHoursFromMin(minutes: number | null): string {
  if (minutes === null) return "--";
  return `${(minutes / 60).toFixed(1)}h`;
}

// 用 Record 而非 if 链兜底：新增规律度档位时 TypeScript 必报缺键，
// 不会像旧的 else 兜底那样把新态静默渲染成「未配置睡眠分类」。
const ROUTINE_STATE_TEXT: Record<RoutineRegularityState, string> = {
  stable: "作息较稳定",
  moderate: "作息规律一般",
  variable: "作息波动较大",
  insufficientSamples: "样本不足，仅展示原始指标",
  noSamples: "暂无睡眠样本",
  notConfigured: "未配置睡眠分类",
};

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
          className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-border bg-surface px-4 td-text-label text-ink-2"
        >
          设置睡眠分类后可查看作息分析
          <Icon icon={CaretRight} size={14} className="text-ink-3" />
        </Link>
      ) : routine.sampleCount === 0 ? (
        <p className="td-text-body text-ink-3">本周期暂无睡眠样本。</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 td-text-label sm:grid-cols-3">
            <MetricCard label="平均入睡" value={formatClockFromMinute(routine.averageBedTimeMin)} />
            <MetricCard label="平均起床" value={formatClockFromMinute(routine.averageWakeTimeMin)} />
            <MetricCard label="平均睡眠" value={formatHoursFromMin(routine.averageDurationMin)} tone="good" />
          </div>
          <p className="td-text-caption text-ink-3">
            {ROUTINE_STATE_TEXT[routine.regularity.state]} · 样本 {routine.sampleCount} 天
            {routine.sleepWindow.source === "samples" &&
              ` · 通常睡眠时段 ${formatClockFromMinute(routine.sleepWindow.startMin)}~${formatClockFromMinute(routine.sleepWindow.endMin)}`}
          </p>
        </div>
      )}
    </SectionPanel>
  );
}
