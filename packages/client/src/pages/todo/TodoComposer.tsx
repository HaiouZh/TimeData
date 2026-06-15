import { type FormEvent, useState } from "react";
import type { Recurrence } from "@timedata/shared";
import { RecurrenceEditor } from "../../components/RecurrenceEditor.js";
import { BOTTOM_NAV_HEIGHT_PX } from "../../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { addTask } from "../../lib/tasks.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";

export function TodoComposer() {
  const destination = useTodoDefaultDestination();
  const { syncAfterWrite } = useSyncContext();
  const [title, setTitle] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addTask({ title, recurrence, toInbox: destination === "inbox" });
      setTitle("");
      setRecurrence(null);
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="fixed left-0 right-0 max-h-[70vh] overflow-y-auto border-t border-slate-800/80 bg-slate-950/95 p-2 backdrop-blur sm:p-3"
      style={{ bottom: BOTTOM_NAV_HEIGHT_PX }}
    >
      <div className="mx-auto w-full max-w-2xl space-y-2 lg:max-w-5xl">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="添加任务…"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          <label className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-300">
            <input
              type="checkbox"
              aria-label="重复"
              checked={recurrence !== null}
              onChange={(event) =>
                setRecurrence(event.currentTarget.checked ? { freq: "daily", interval: 1, basis: "due" } : null)
              }
              className="h-4 w-4 accent-sky-500"
            />
            重复
          </label>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="min-h-11 shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            添加
          </button>
        </div>
        {recurrence && <RecurrenceEditor value={recurrence} onChange={setRecurrence} />}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    </form>
  );
}
