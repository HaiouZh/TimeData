import type { TimeEntry } from "@timedata/shared";
import { useCategories } from "../hooks/useCategories.ts";
import type { TimeSlot } from "../lib/time.ts";
import type { RingSelectionTarget } from "./CircularTimeline.tsx";
import TimeSlotComponent from "./TimeSlot.tsx";

interface TimelineProps {
  slots: TimeSlot[];
  onGapClick: (startTime: string, endTime: string) => void;
  onEntryClick: (entry: TimeEntry) => void;
  highlight?: RingSelectionTarget | null;
}

const MIN_TERMINAL_GAP_MS = 2 * 60 * 1000;

function slotDurationMs(slot: TimeSlot): number {
  return Math.max(0, new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime());
}

function isHighlighted(slot: TimeSlot, highlight: RingSelectionTarget | null | undefined): boolean {
  if (!highlight) return false;
  if (slot.entry) return highlight.type === "entry" && highlight.entryId === slot.entry.id;
  return highlight.type === "gap" && highlight.startTime === slot.startTime;
}

export default function Timeline({ slots, onGapClick, onEntryClick, highlight }: TimelineProps) {
  const { getCategoryPath, getCategoryColor } = useCategories();
  const displaySlots = slots
    .filter((slot, index) => {
      if (slot.kind === "future") return false;
      return !(slot.kind === "gap" && slots[index + 1]?.kind === "future" && slotDurationMs(slot) < MIN_TERMINAL_GAP_MS);
    })
    .slice()
    .reverse();

  if (displaySlots.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-ink-2">今天还没有记录</div>;
  }

  return (
    <section className="px-4 pb-2 pt-4">
      <h2 className="mb-1.5 px-0.5 text-xs font-medium text-ink-3">时间流</h2>
      {displaySlots.map((slot) => {
        const slotKey = slot.entry
          ? `entry-${slot.entry.id}-${slot.startTime}-${slot.endTime}`
          : `gap-${slot.startTime}-${slot.endTime}`;
        return (
          <TimeSlotComponent
            key={slotKey}
            slot={slot}
            categoryPath={slot.entry ? getCategoryPath(slot.entry.categoryId) : ""}
            categoryColor={slot.entry ? getCategoryColor(slot.entry.categoryId) : ""}
            highlighted={isHighlighted(slot, highlight)}
            onClick={() => (slot.entry ? onEntryClick(slot.entry) : onGapClick(slot.startTime, slot.endTime))}
          />
        );
      })}
    </section>
  );
}
