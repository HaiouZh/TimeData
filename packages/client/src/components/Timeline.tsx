import type { TimeEntry } from "@timedata/shared";
import { useCategories } from "../hooks/useCategories.ts";
import type { TimeSlot } from "../lib/time.ts";
import TimeSlotComponent from "./TimeSlot.tsx";

interface TimelineProps {
  slots: TimeSlot[];
  onGapClick: (startTime: string, endTime: string) => void;
  onEntryClick: (entry: TimeEntry) => void;
}

export default function Timeline({ slots, onGapClick, onEntryClick }: TimelineProps) {
  const { getCategoryPath, getCategoryColor } = useCategories();
  const displaySlots = slots.filter((slot) => slot.kind !== "future").slice().reverse();

  if (displaySlots.length === 0) {
    return <div className="p-8 text-center text-slate-500">今天还没有记录</div>;
  }

  return (
    <div className="relative px-3 py-2">
      {/* vertical timeline rail */}
      <div className="absolute left-[1.6rem] top-0 bottom-0 w-px bg-slate-800" />
      {displaySlots.map((slot, i) => (
        <TimeSlotComponent
          key={`${slot.startTime}-${i}`}
          slot={slot}
          categoryPath={slot.entry ? getCategoryPath(slot.entry.categoryId) : ""}
          categoryColor={slot.entry ? getCategoryColor(slot.entry.categoryId) : ""}
          onClick={() => (slot.entry ? onEntryClick(slot.entry) : onGapClick(slot.startTime, slot.endTime))}
        />
      ))}
    </div>
  );
}
