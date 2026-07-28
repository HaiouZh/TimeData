import { completionEvents } from "../../../../lib/todoStats/events.js";
import { rhythmMatrix } from "../../../../lib/todoStats/rhythm.js";
import type { TodoStatsModuleProps } from "../types.ts";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const SLOT_LABELS = ["0-6", "6-12", "12-18", "18-24"];

export default function RhythmSection({ tasks }: TodoStatsModuleProps) {
  const completedAt = completionEvents(tasks).map((event) => event.completedAt);
  const matrix = rhythmMatrix(completedAt);
  const max = Math.max(0, ...matrix.flat());

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="td-text-label font-medium text-fg-muted">节奏</h3>
      <div className="mt-2 grid grid-cols-[auto_repeat(4,1fr)] gap-1 td-text-caption">
        <div />
        {SLOT_LABELS.map((label) => (
          <div key={label} className="text-center text-muted-foreground">
            {label}
          </div>
        ))}
        {matrix.map((row, dayIndex) => (
          <div key={WEEKDAY_LABELS[dayIndex]} className="contents">
            <div className="pr-1 text-muted-foreground">周{WEEKDAY_LABELS[dayIndex]}</div>
            {row.map((count, slotIndex) => (
              <div
                key={slotIndex}
                title={`周${WEEKDAY_LABELS[dayIndex]} ${SLOT_LABELS[slotIndex]} · ${count}`}
                className="aspect-square rounded-[2px] bg-accent"
                style={{ opacity: max > 0 ? count / max : 0 }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
