import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { Recurrence, Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { RecurrenceEditor } from "../components/RecurrenceEditor.js";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { addTask, deleteTask, listTasksLegacy, toggleTaskDone, updateTask } from "../lib/tasks.js";
import { isDueNow, recurrenceSummary, formatCreatedAt } from "../lib/tasks/recurrence.js";

const EMPTY_LISTS: { pool: Task[]; recurring: Task[] } = { pool: [], recurring: [] };

function TaskRow({
  task,
  recurring,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task;
  recurring: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const due = task.recurrence ? isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : !task.done;
  const checked = recurring ? !due : task.done;

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`完成 ${task.title}`}
          checked={checked}
          onChange={() => onToggle(task)}
          className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
        />
        <div className="min-w-0 flex-1">
          <div className={`break-words text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-slate-100"}`}>
            {task.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {task.recurrence ? (
              <>
                <span>{recurrenceSummary(task.recurrence)}</span>
                <span className={due ? "text-amber-300" : "text-emerald-300"}>{due ? "待做" : "已完成"}</span>
              </>
            ) : (
              <span>{formatCreatedAt(task.createdAt)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="min-h-8 rounded-lg border border-slate-700 px-2 text-xs text-slate-300"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => onDelete(task)}
            className="min-h-8 rounded-lg border border-rose-900/70 px-2 text-xs text-rose-200"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}

export function TodoPage() {
  const tasks = useLiveQuery(() => listTasksLegacy(), [], EMPTY_LISTS) ?? EMPTY_LISTS;
  const [draftTitle, setDraftTitle] = useState("");
  const [draftRecurrence, setDraftRecurrence] = useState<Recurrence | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { syncAfterWrite } = useSyncContext();

  const pool = useMemo(
    () => [...tasks.pool].sort((a, b) => Number(a.done) - Number(b.done) || a.sortOrder - b.sortOrder),
    [tasks.pool],
  );
  const completedPool = useMemo(() => pool.filter((task) => task.done), [pool]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateTask(editingId, { title: draftTitle, recurrence: draftRecurrence });
      } else {
        await addTask({ title: draftTitle, recurrence: draftRecurrence });
      }
      setDraftTitle("");
      setDraftRecurrence(null);
      setEditingId(null);
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(task: Task) {
    await toggleTaskDone(task.id);
    syncAfterWrite();
  }

  async function remove(task: Task) {
    await deleteTask(task.id);
    if (editingId === task.id) {
      setEditingId(null);
      setDraftTitle("");
      setDraftRecurrence(null);
    }
    syncAfterWrite();
  }

  async function clearCompleted() {
    await Promise.all(completedPool.map((task) => deleteTask(task.id)));
    syncAfterWrite();
  }

  function edit(task: Task) {
    setEditingId(task.id);
    setDraftTitle(task.title);
    setDraftRecurrence(task.recurrence);
    setError(null);
  }

  return (
    <div className="min-h-full bg-slate-950 px-4 py-4 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder="添加任务…"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {editingId ? "保存" : "添加"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraftTitle("");
                  setDraftRecurrence(null);
                }}
                className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm text-slate-300"
              >
                取消
              </button>
            )}
          </div>
          <RecurrenceEditor value={draftRecurrence} onChange={setDraftRecurrence} />
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </form>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">重复任务</h2>
            <span className="text-xs text-slate-500">{tasks.recurring.length}</span>
          </div>
          {tasks.recurring.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">暂无重复任务</p>
          ) : (
            <ul className="space-y-2">
              {tasks.recurring.map((task) => (
                <TaskRow key={task.id} task={task} recurring onToggle={toggle} onEdit={edit} onDelete={remove} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-100">任务池</h2>
            {completedPool.length > 0 && (
              <button
                type="button"
                onClick={clearCompleted}
                className="min-h-8 rounded-lg border border-slate-700 px-2 text-xs text-slate-300"
              >
                清除已完成
              </button>
            )}
          </div>
          {pool.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">暂无池任务</p>
          ) : (
            <ul className="space-y-2">
              {pool.map((task) => (
                <TaskRow key={task.id} task={task} recurring={false} onToggle={toggle} onEdit={edit} onDelete={remove} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
