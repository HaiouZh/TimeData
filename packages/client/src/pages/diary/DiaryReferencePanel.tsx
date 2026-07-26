import { formatMonthDay } from "../../lib/time.js";

import { DiaryRefDoneTasks } from "./DiaryRefDoneTasks.js";
import { DiaryRefLookback } from "./DiaryRefLookback.js";
import { DiaryRefPunches } from "./DiaryRefPunches.js";
import { DiaryRefQuickNotes } from "./DiaryRefQuickNotes.js";

export interface DiaryReferencePanelProps {
  date: string;
  isToday: boolean;
}

export function DiaryReferencePanel({ date, isToday }: DiaryReferencePanelProps) {
  return (
    <div className="space-y-5 px-3 py-4" data-testid="diary-reference-panel">
      <section className="space-y-1">
        <h2 className="px-2 td-text-label font-medium text-ink-3">{isToday ? "今天" : formatMonthDay(date)}</h2>
        <DiaryRefPunches date={date} />
        <DiaryRefDoneTasks date={date} />
        <DiaryRefQuickNotes date={date} />
      </section>
      <section className="space-y-1 border-t border-border pt-4">
        <h2 className="px-2 td-text-label font-medium text-ink-3">回看</h2>
        <DiaryRefLookback date={date} />
      </section>
    </div>
  );
}
