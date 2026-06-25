import type { TimeEntry } from "@timedata/shared";
import { useCategories } from "../hooks/useCategories.ts";
import type { TimeSlot } from "../lib/time.ts";
import TimeSlotComponent from "./TimeSlot.tsx";

interface TimelineProps {
  slots: TimeSlot[];
  onGapClick: (startTime: string, endTime: string) => void;
  onEntryClick: (entry: TimeEntry) => void;
}

const MIN_TERMINAL_GAP_MS = 2 * 60 * 1000;

function slotDurationMs(slot: TimeSlot): number {
  return Math.max(0, new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime());
}

export default function Timeline({ slots, onGapClick, onEntryClick }: TimelineProps) {
  const { getCategoryPath, getCategoryColor } = useCategories();
  const displaySlots = slots
    .filter((slot, index) => {
      if (slot.kind === "future") return false;
      return !(slot.kind === "gap" && slots[index + 1]?.kind === "future" && slotDurationMs(slot) < MIN_TERMINAL_GAP_MS);
    })
    .slice()
    .reverse();

  if (displaySlots.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-slate-400">今天还没有记录</div>;
  }

  return (
    <section className="px-4 pb-2 pt-4">
      <h2 className="mb-1.5 px-0.5 text-xs font-medium text-slate-500">时间流</h2>
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
            onClick={() => (slot.entry ? onEntryClick(slot.entry) : onGapClick(slot.startTime, slot.endTime))}
          />
        );
      })}
    </section>
  );
}
