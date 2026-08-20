import { Plus } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { TimeSlot as TimeSlotType } from "../lib/time.ts";
import { formatDuration, formatTimelineTimeRange } from "../lib/time.ts";
import { Icon } from "./Icon.js";

interface TimeSlotProps {
  slot: TimeSlotType;
  categoryPath: string;
  categoryColor: string;
  onClick: () => void;
  highlighted?: boolean;
  conflicted?: boolean;
}

export default function TimeSlot({ slot, categoryPath, categoryColor, onClick, highlighted, conflicted }: TimeSlotProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isGap = slot.entry === null;
  const duration = formatDuration(slot.startTime, slot.endTime);
  const timeRange = formatTimelineTimeRange(slot.startTime, slot.endTime, { mode: slot.displayMode });

  useEffect(() => {
    if (highlighted) rootRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);

  if (isGap) {
    return (
      <div
        ref={rootRef}
        className="mb-1.5"
        data-slot-highlighted={highlighted ? "true" : undefined}
        data-slot-conflicted={conflicted ? "true" : undefined}
      >
        <button
          onClick={onClick}
          className={`group flex min-h-14 w-full flex-col justify-center gap-0.5 rounded-row border border-dashed border-border bg-surface/40 py-3 pl-3.5 pr-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60 active:bg-surface-hover${highlighted ? " ring-2 ring-inset ring-accent" : ""}${conflicted ? " ring-2 ring-inset ring-warn" : ""}`}
        >
          <span className="td-time td-text-caption text-ink-2">{timeRange}</span>
          <div className="flex items-center gap-1.5 text-ink-2 transition-colors group-hover:text-ink">
            <span className="inline-flex items-center gap-1 td-text-caption font-medium">
              <Icon icon={Plus} size={14} />
              <span>补记这段</span>
            </span>
            <span className="td-duration td-text-caption">· {duration}</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="mb-1.5"
      data-slot-highlighted={highlighted ? "true" : undefined}
      data-slot-conflicted={conflicted ? "true" : undefined}
    >
      <button
        onClick={onClick}
        className={`w-full rounded-row border border-transparent py-2.5 pl-3.5 pr-3 text-left transition-all hover:border-border${highlighted ? " ring-2 ring-inset ring-accent" : ""}${conflicted ? " ring-2 ring-inset ring-warn" : ""}`}
        style={{ backgroundColor: `${categoryColor}1a`, boxShadow: `inset 3px 0 0 ${categoryColor}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="td-text-body font-medium text-ink">{categoryPath}</span>
          <span className="td-duration mt-0.5 shrink-0 td-text-caption text-ink-2">{duration}</span>
        </div>
        <div className="td-time mt-0.5 td-text-caption text-ink-2">{timeRange}</div>
        {slot.entry?.note && <div className="mt-1 line-clamp-1 td-text-caption text-ink-2">{slot.entry.note}</div>}
      </button>
    </div>
  );
}
