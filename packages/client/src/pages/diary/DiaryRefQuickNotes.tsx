import { useLiveQuery } from "dexie-react-hooks";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { listQuickNotesByDate } from "../../lib/quickNotes.js";
import { formatTime } from "../../lib/time.js";
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
            <li key={n.id} className="px-2 py-1">
              <span className="td-time mr-1.5 td-text-caption text-ink-3">{formatTime(n.occurredAt)}</span>
              <span className="td-text-label text-ink">{n.text}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
