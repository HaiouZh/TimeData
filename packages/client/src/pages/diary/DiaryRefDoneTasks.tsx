import { useLiveQuery } from "dexie-react-hooks";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { selectTasksCompletedOn } from "../../lib/diary/diaryRefTasks.js";
import { listTasks } from "../../lib/tasks.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";

export function DiaryRefDoneTasks({ date }: { date: string }) {
  const rows = useLiveQuery(async () => selectTasksCompletedOn((await listTasks()).completed, date), [date]);
  const loading = rows === undefined;
  const items = rows ?? [];

  return (
    <CollapsibleSection
      title="完成的待办"
      count={items.length}
      defaultOpen={!getDiaryRefCollapsed("doneTasks")}
      onToggle={(open) => setDiaryRefCollapsed("doneTasks", !open)}
    >
      {loading ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">读取中…</p>
      ) : items.length === 0 ? (
        <p className="px-2 py-1 td-text-caption text-ink-3">这天没有完成的待办</p>
      ) : (
        <ul className="space-y-0.5" data-testid="diary-ref-done-task-list">
          {items.map((t) => (
            <li key={t.id} className="px-2 py-1 td-text-label text-ink">
              {t.title}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
