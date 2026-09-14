import { useLiveQuery } from "dexie-react-hooks";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { listQuickNotesByDate } from "../../lib/quickNotes.js";
import { formatTime } from "../../lib/time.js";
import QuickNoteContent from "../../quick-notes/QuickNoteContent.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";

export function DiaryRefQuickNotes({ date }: { date: string }) {
  const rows = useLiveQuery(() => listQuickNotesByDate(date), [date]);
  const loading = rows === undefined;
  const items = rows ?? [];

  return (
    <CollapsibleSection
      title="速记"
      count={items.length}
      defaultOpen={!getDiaryRefCollapsed("quickNotes")}
      onToggle={(open) => setDiaryRefCollapsed("quickNotes", !open)}
    >
      {loading ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">读取中…</p>
      ) : items.length === 0 ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">这天没有速记</p>
      ) : (
        <ul className="space-y-1" data-testid="diary-ref-quick-note-list">
          {items.map((n) => (
            <li key={n.id} className="flex items-baseline gap-1.5 px-2 py-1">
              <span className="td-time shrink-0 td-text-caption text-ink-3">{formatTime(n.occurredAt)}</span>
              {/* 与速记页同一个渲染器：Markdown 成排版、纯文本保留换行；min-w-0 让长内容在窄栏里折行而不撑宽 */}
              <div className="min-w-0 flex-1 td-text-label text-ink">
                <QuickNoteContent text={n.text} textClassName="td-text-label" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
