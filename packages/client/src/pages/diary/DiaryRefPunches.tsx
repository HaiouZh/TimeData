import { useLiveQuery } from "dexie-react-hooks";
import { useCategories } from "../../hooks/useCategories.js";
import { clipEntriesToDay } from "../../lib/diary/diaryRefEntries.js";
import { listEntriesOverlappingDay } from "../../lib/diary/diaryRefEntriesQuery.js";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { formatDuration, formatTimelineTimeRange } from "../../lib/time.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";

export function DiaryRefPunches({ date }: { date: string }) {
  // 直接查当天窗口，不走 useEntries：理由见 listEntriesOverlappingDay 的注释（多一条无用全表扫描，
  // 且它把「查询未回」的 undefined 兜底成 []，会让本块在加载中谎报「这天没有打点」）。
  const entries = useLiveQuery(() => listEntriesOverlappingDay(date), [date]);
  const { getCategoryPath } = useCategories();
  const loading = entries === undefined;
  const rows = entries === undefined ? [] : clipEntriesToDay(entries, date);

  return (
    <CollapsibleSection
      title="打点"
      count={rows.length}
      defaultOpen={!getDiaryRefCollapsed("punches")}
      onToggle={(open) => setDiaryRefCollapsed("punches", !open)}
    >
      {loading ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">读取中…</p>
      ) : rows.length === 0 ? (
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
