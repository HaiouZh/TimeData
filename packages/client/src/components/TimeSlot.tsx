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
      <div className="relative pl-7 mb-1.5">
        <div
          className="absolute left-[0.85rem] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-slate-700 ring-2 ring-slate-900"
        />
        <button
          onClick={onClick}
          className="w-full text-left px-3 py-3 min-h-[56px] rounded-lg border border-dashed border-slate-700 bg-slate-900/40 hover:bg-slate-800/60 hover:border-slate-600 active:bg-slate-800 transition-colors group flex flex-col justify-center gap-0.5"
        >
          <span className="text-xs text-slate-600 font-mono">{timeRange}</span>
          <div className="flex items-center gap-1.5 text-slate-500 group-hover:text-slate-300 transition-colors">
            <span className="text-xs font-medium">＋ 补记这段</span>
            <span className="text-xs">· {duration}</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="relative pl-7 mb-1.5">
      <div
        className="absolute left-[0.85rem] top-3 w-1.5 h-1.5 rounded-full ring-2 ring-slate-900"
        style={{ backgroundColor: categoryColor }}
      />
      <button
        onClick={onClick}
        className="w-full text-left px-3 py-2.5 rounded-lg border border-transparent hover:border-slate-700 transition-all"
        style={{ backgroundColor: `${categoryColor}18` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight" style={{ color: categoryColor }}>
            {categoryPath}
          </span>
          <span className="text-xs text-slate-500 shrink-0 mt-0.5">{duration}</span>
        </div>
        <div className="mt-0.5 text-xs text-slate-500 font-mono">{timeRange}</div>
        {slot.entry?.note && (
          <div className="mt-1 text-xs text-slate-400 line-clamp-1">{slot.entry.note}</div>
        )}
      </button>
    </div>
  );
}
