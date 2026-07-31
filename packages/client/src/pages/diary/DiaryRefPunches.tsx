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
  const { getCategoryPath, getCategoryColor } = useCategories();
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
        <ul className="space-y-1" data-testid="diary-ref-punch-list">
          {rows.map((row) => {
            // 与时间线同一套上色（TimeSlot.tsx）：左侧 3px 实色条 + 同色 10%(0x1a) 底。
            // 逐字复用而不是另调一套，是为了"日记参考栏里的这条打点"和"时间线里的那条打点"
            // 一眼就是同一个分类——两边各调各的色，同一分类在两个页面会长得不像同一件事。
            // getCategoryColor 对子分类返回父分类的颜色，配色粒度也与时间线一致。
            const color = getCategoryColor(row.categoryId);
            return (
              <li
                key={row.id}
                className="rounded-row py-1 pl-3 pr-2"
                style={{ backgroundColor: `${color}1a`, boxShadow: `inset 3px 0 0 ${color}` }}
              >
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
            );
          })}
        </ul>
      )}
    </CollapsibleSection>
  );
}
