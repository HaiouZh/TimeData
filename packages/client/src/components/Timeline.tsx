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
  const displaySlots = slots.slice().reverse();

  if (slots.length === 0) {
    return <div className="p-8 text-center text-slate-500">今天还没有记录</div>;
  }

  return (
    <div className="p-2">
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
