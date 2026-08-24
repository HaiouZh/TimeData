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
        className="mb-1"
        data-slot-highlighted={highlighted ? "true" : undefined}
        data-slot-conflicted={conflicted ? "true" : undefined}
      >
        <button
          onClick={onClick}
          className={`group flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-row border border-dashed border-border bg-surface/40 py-1 pl-3.5 pr-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60 active:bg-surface-hover${highlighted ? " ring-2 ring-inset ring-accent" : ""}${conflicted ? " ring-2 ring-inset ring-warn" : ""}`}
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
      className="mb-1"
      data-slot-highlighted={highlighted ? "true" : undefined}
      data-slot-conflicted={conflicted ? "true" : undefined}
    >
      <button
        onClick={onClick}
        // min-h-11 是触控底线（invariants §2），不是版式留白：py-1 压到 4px 后单行卡只剩
        // 约 30px，靠这条兜到 44px；有备注的卡由内容自然撑高，兜底不参与。
        className={`flex min-h-11 w-full flex-col justify-center rounded-row border border-transparent py-1 pl-3.5 pr-3 text-left transition-all hover:border-border${highlighted ? " ring-2 ring-inset ring-accent" : ""}${conflicted ? " ring-2 ring-inset ring-warn" : ""}`}
        style={{ backgroundColor: `${categoryColor}1a`, boxShadow: `inset 3px 0 0 ${categoryColor}` }}
      >
        <div className="flex items-baseline gap-2">
          <span className="td-time shrink-0 td-text-caption text-ink-2">{timeRange}</span>
          <span className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">{categoryPath}</span>
          <span className="td-duration shrink-0 td-text-caption text-ink-2">{duration}</span>
        </div>
        {slot.entry?.note && <div className="mt-1 line-clamp-1 td-text-caption text-ink-2">{slot.entry.note}</div>}
      </button>
    </div>
  );
}
