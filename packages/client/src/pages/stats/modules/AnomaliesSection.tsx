import { utcToLocalDateTime } from "@timedata/shared";
import { useMemo } from "react";
import { memoAnomalies, memoRoutine } from "../../../lib/insights/cache.ts";
import type { Anomaly } from "../../../lib/insights/types.ts";
import type { StatsModuleProps } from "./types.ts";
import { MetricCard, SectionPanel } from "./ui.tsx";

const ANOMALY_LABEL: Record<string, string> = {
  overlong: "超长记录",
  overnight: "跨午夜",
  sleepTimeActivity: "睡眠时段活动",
  longGap: "长空挡",
  unrecordedDay: "未记录日",
};

interface AnomalyDateGroup {
  date: string;
  items: Anomaly[];
}

function groupAnomaliesByDate(items: Anomaly[]): AnomalyDateGroup[] {
  const groups = new Map<string, Anomaly[]>();
  for (const item of items) {
    const group = groups.get(item.date) ?? [];
    group.push(item);
    groups.set(item.date, group);
  }
  return Array.from(groups.entries()).map(([date, groupItems]) => ({ date, items: groupItems }));
}

function formatDurationFromMin(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "--";
  if (minutes < 60) return `${Math.round(minutes)}min`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatAnomalyTimeRange(anomaly: Anomaly): string | null {
  if (!anomaly.startTime || !anomaly.endTime) return null;
  const start = utcToLocalDateTime(anomaly.startTime);
  const end = utcToLocalDateTime(anomaly.endTime);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);
  if (startDate === endDate) return `${start.slice(11, 16)} - ${end.slice(11, 16)}`;
  return `${startDate.slice(5)} ${start.slice(11, 16)} - ${endDate.slice(5)} ${end.slice(11, 16)}`;
}

function anomalyKey(anomaly: Anomaly, scope: string): string {
  return [
    scope,
    anomaly.type,
    anomaly.date,
    anomaly.startTime ?? "",
    anomaly.endTime ?? "",
    anomaly.categoryId ?? "",
    anomaly.valueMin ?? "",
    anomaly.baselineMin ?? "",
    anomaly.message,
  ].join(":");
}

export default function AnomaliesSection(props: StatsModuleProps) {
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

  const anomalies = useMemo(
    () =>
      memoAnomalies({
        entries: props.entries,
        baselineEntries: props.baselineEntries,
        categories: props.categories,
        fromDate: props.effectiveRange.fromDate,
        toDate: props.effectiveRange.toDate,
        baselineFromDate: props.baselineFrom,
        baselineToDate: props.today,
        sleepCategoryId: props.sleepCategoryId,
        sleepWindow: routine.sleepWindow,
      }),
    [
      props.entries,
      props.baselineEntries,
      props.categories,
      props.effectiveRange.fromDate,
      props.effectiveRange.toDate,
      props.baselineFrom,
      props.today,
      props.sleepCategoryId,
      routine.sleepWindow,
    ],
  );

  const anomalyDateGroups = useMemo(() => groupAnomaliesByDate(anomalies), [anomalies]);
  const longGapAnomalies = useMemo(
    () =>
      anomalies.filter((anomaly) => anomaly.type === "longGap").sort((a, b) => (b.valueMin ?? 0) - (a.valueMin ?? 0)),
    [anomalies],
  );
  const anomalyStats = useMemo(() => {
    const longGapCount = longGapAnomalies.length;
    const longGapTotalMin = longGapAnomalies.reduce((sum, anomaly) => sum + (anomaly.valueMin ?? 0), 0);
    const unrecordedDayCount = anomalies.filter((anomaly) => anomaly.type === "unrecordedDay").length;
    const recordIssueCount = anomalies.filter(
      (anomaly) => anomaly.type === "overlong" || anomaly.type === "overnight" || anomaly.type === "sleepTimeActivity",
    ).length;
    return {
      longGapCount,
      longGapTotalMin,
      longestGapMin: longGapAnomalies[0]?.valueMin ?? null,
      unrecordedDayCount,
      recordIssueCount,
    };
  }, [anomalies, longGapAnomalies]);

  return (
    <SectionPanel
      title="异常与空挡"
      eyebrow="Attention"
      action={
        anomalies.length > 0 ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100">
            {anomalies.length} 项
          </span>
        ) : null
      }
    >
      {anomalies.length === 0 ? (
        <p className="text-sm text-slate-500">本周期未发现明显异常或长空挡。</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <MetricCard
              label="长空挡"
              value={anomalyStats.longGapCount}
              hint={`最长 ${formatDurationFromMin(anomalyStats.longestGapMin)}`}
              tone="warn"
            />
            <MetricCard
              label="空挡合计"
              value={formatDurationFromMin(anomalyStats.longGapTotalMin)}
              hint="超过个人阈值"
              tone="warn"
            />
            <MetricCard
              label="记录异常"
              value={anomalyStats.recordIssueCount}
              hint={`未记录日 ${anomalyStats.unrecordedDayCount}`}
              tone="danger"
            />
          </div>

          {longGapAnomalies.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium text-slate-500">长空挡 Top</div>
              <ul className="space-y-1.5">
                {longGapAnomalies.slice(0, 5).map((anomaly) => (
                  <li
                    key={anomalyKey(anomaly, "top")}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 text-slate-300">
                      {anomaly.date}
                      {formatAnomalyTimeRange(anomaly) && (
                        <span className="ml-2 text-xs text-slate-500">{formatAnomalyTimeRange(anomaly)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-slate-100">{formatDurationFromMin(anomaly.valueMin)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details
            className="mt-4 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/40 px-3 py-2"
            open={props.mode !== "month"}
          >
            <summary className="min-h-10 cursor-pointer py-2 text-xs font-medium text-slate-400">按日期分布</summary>
            <div className="mt-2 space-y-2">
              {anomalyDateGroups.map((group) => (
                <div key={group.date} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-200">{group.date}</span>
                    <span className="text-xs text-slate-500">{group.items.length} 项</span>
                  </div>
                  <ul className="mt-2 divide-y divide-slate-700/60">
                    {group.items.map((anomaly) => {
                      const timeRange = formatAnomalyTimeRange(anomaly);
                      return (
                        <li
                          key={anomalyKey(anomaly, "detail")}
                          className="py-2 first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                              {ANOMALY_LABEL[anomaly.type] ?? anomaly.type}
                            </span>
                            {timeRange && <span className="text-xs text-slate-500">{timeRange}</span>}
                            {anomaly.valueMin !== undefined && (
                              <span className="text-xs text-slate-400">{formatDurationFromMin(anomaly.valueMin)}</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-300">{anomaly.message}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </SectionPanel>
  );
}
