import { useCategories } from "../../hooks/useCategories.js";
import { useEntries } from "../../hooks/useEntries.js";
import { clipEntriesToDay } from "../../lib/diary/diaryRefEntries.js";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { formatDuration, formatTimelineTimeRange } from "../../lib/time.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";

export function DiaryRefPunches({ date }: { date: string }) {
  const { entries } = useEntries(date);
  const { getCategoryPath } = useCategories();
  const rows = clipEntriesToDay(entries, date);

  return (
    <CollapsibleSection
      title="打点"
      count={rows.length}
      defaultOpen={!getDiaryRefCollapsed("punches")}
      onToggle={(open) => setDiaryRefCollapsed("punches", !open)}
    >
      {rows.length === 0 ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">这天没有打点</p>
      ) : (
        <ul className="space-y-0.5" data-testid="diary-ref-punch-list">
          {rows.map((row) => (
            <li key={row.id} className="px-2 py-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="td-text-label text-ink">{getCategoryPath(row.categoryId)}</span>
                <span className="td-duration shrink-0 td-text-caption text-ink-3">
                  {formatDuration(row.startTime, row.endTime)}
                </span>
              </div>
              <div className="td-time td-text-caption text-ink-3">
                {formatTimelineTimeRange(row.startTime, row.endTime, row.clippedEnd ? { mode: "truncated" } : {})}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
