import type { TimeSlot as TimeSlotType } from "../lib/time.ts";
import { formatDuration, formatTimelineTimeRange } from "../lib/time.ts";

interface TimeSlotProps {
  slot: TimeSlotType;
  categoryPath: string;
  categoryColor: string;
  onClick: () => void;
}

export default function TimeSlot({ slot, categoryPath, categoryColor, onClick }: TimeSlotProps) {
  const isGap = slot.entry === null;
  const duration = formatDuration(slot.startTime, slot.endTime);
  const timeRange = formatTimelineTimeRange(slot.startTime, slot.endTime, { mode: slot.displayMode });

  if (isGap) {
    return (
      <div className="mb-1.5">
        <button
          onClick={onClick}
          className="group flex min-h-[56px] w-full flex-col justify-center gap-0.5 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 py-3 pl-3.5 pr-3 text-left transition-colors hover:border-slate-600 hover:bg-slate-800/60 active:bg-slate-800"
        >
          <span className="font-mono text-xs text-slate-400">{timeRange}</span>
          <div className="flex items-center gap-1.5 text-slate-400 transition-colors group-hover:text-slate-200">
            <span className="text-xs font-medium">＋ 补记这段</span>
            <span className="text-xs">· {duration}</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-1.5">
      <button
        onClick={onClick}
        className="w-full rounded-lg border border-transparent py-2.5 pl-3.5 pr-3 text-left transition-all hover:border-slate-700"
        style={{ backgroundColor: `${categoryColor}1a`, boxShadow: `inset 3px 0 0 ${categoryColor}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight text-slate-100">{categoryPath}</span>
          <span className="mt-0.5 shrink-0 text-xs text-slate-400">{duration}</span>
        </div>
        <div className="mt-0.5 font-mono text-xs text-slate-400">{timeRange}</div>
        {slot.entry?.note && <div className="mt-1 line-clamp-1 text-xs text-slate-400">{slot.entry.note}</div>}
      </button>
    </div>
  );
}
