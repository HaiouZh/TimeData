import { Plus } from "@phosphor-icons/react";
import type { TimeSlot as TimeSlotType } from "../lib/time.ts";
import { formatDuration, formatTimelineTimeRange } from "../lib/time.ts";
import { Icon } from "./Icon.js";

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
          className="group flex min-h-[56px] w-full flex-col justify-center gap-0.5 rounded-lg border border-dashed border-border bg-surface/40 py-3 pl-3.5 pr-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60 active:bg-surface-hover"
        >
          <span className="td-time text-xs text-ink-2">{timeRange}</span>
          <div className="flex items-center gap-1.5 text-ink-2 transition-colors group-hover:text-ink">
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              <Icon icon={Plus} size={14} />
              <span>补记这段</span>
            </span>
            <span className="td-duration text-xs">· {duration}</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-1.5">
      <button
        onClick={onClick}
        className="w-full rounded-lg border border-transparent py-2.5 pl-3.5 pr-3 text-left transition-all hover:border-border"
        style={{ backgroundColor: `${categoryColor}1a`, boxShadow: `inset 3px 0 0 ${categoryColor}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight text-ink">{categoryPath}</span>
          <span className="td-duration mt-0.5 shrink-0 text-xs text-ink-2">{duration}</span>
        </div>
        <div className="td-time mt-0.5 text-xs text-ink-2">{timeRange}</div>
        {slot.entry?.note && <div className="mt-1 line-clamp-1 text-xs text-ink-2">{slot.entry.note}</div>}
      </button>
    </div>
  );
}
