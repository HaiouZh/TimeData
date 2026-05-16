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

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-4 mb-1 rounded-r transition-colors ${
        isGap ? "border-slate-600 bg-slate-800/50 hover:bg-slate-800" : "hover:brightness-110"
      }`}
      style={isGap ? undefined : { borderColor: categoryColor, backgroundColor: `${categoryColor}15` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-slate-400">{formatTimelineTimeRange(slot.startTime, slot.endTime, { mode: slot.displayMode })}</span>
          <span className="ml-2 text-xs text-slate-500">{duration}</span>
        </div>
        {isGap ? (
          <span className="text-sm text-slate-500">点击记录</span>
        ) : (
          <span className="text-sm" style={{ color: categoryColor }}>{categoryPath}</span>
        )}
      </div>
      {slot.entry?.note && <div className="mt-1 text-xs text-slate-400">{slot.entry.note}</div>}
    </button>
  );
}
