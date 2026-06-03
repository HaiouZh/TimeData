import { formatMinutesDuration, summarizeDay, type TimeSlot } from "../lib/time.ts";

interface DayOverviewProps {
  slots: TimeSlot[];
}

export default function DayOverview({ slots }: DayOverviewProps) {
  const { recordedMinutes, gapMinutes, gapCount, coverageRatio } = summarizeDay(slots);
  if (recordedMinutes === 0 && gapMinutes === 0) return null;

  const coveragePct = Math.round(coverageRatio * 100);

  return (
    <section className="px-4 pt-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold text-slate-100">{formatMinutesDuration(recordedMinutes)}</span>
            <span className="text-xs text-slate-400">已记录</span>
          </div>
          <span className="text-xs text-slate-400">
            覆盖 {coveragePct}%{gapCount > 0 ? ` · ${gapCount} 个空档` : ""}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-blue-500/80 transition-[width] duration-300"
            style={{ width: `${coveragePct}%` }}
          />
        </div>
      </div>
    </section>
  );
}
