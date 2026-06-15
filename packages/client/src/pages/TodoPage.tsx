import type { FormEvent } from "react";
import { useState } from "react";
import type { Recurrence, Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { SwipeableList, Type as ListType } from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import { RecurrenceEditor } from "../components/RecurrenceEditor.js";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import {
  addTask, deleteTask, listTasks, scheduleTask, toggleTaskDone,
  unscheduleTask, type TodoBuckets,
} from "../lib/tasks.js";
import { isDueNow, recurrenceSummary } from "../lib/tasks/recurrence.js";
import { placementForTask } from "../lib/tasks/placement.js";
import { SwipeableTaskRow } from "./todo/SwipeableTaskRow.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], upcoming: [], recurring: [], completed: [] };

export function TodoPage() {
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const [draftTitle, setDraftTitle] = useState("");
  const [draftRecurrence, setDraftRecurrence] = useState<Recurrence | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const { syncAfterWrite } = useSyncContext();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addTask({ title: draftTitle, recurrence: draftRecurrence });
      resetForm();
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function submitToInbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addTask({ title: draftTitle, recurrence: draftRecurrence, toInbox: true });
      resetForm();
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setDraftTitle("");
    setDraftRecurrence(null);
  }

  async function toggle(task: Task) {
    await toggleTaskDone(task.id);
    syncAfterWrite();
  }

  async function remove(task: Task) {
    await deleteTask(task.id);
    if (detailId === task.id) setDetailId(null);
    syncAfterWrite();
  }

  async function moveToToday(task: Task) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    await scheduleTask(task.id, `${yyyy}-${mm}-${dd}`);
    syncAfterWrite();
  }

  async function moveToInbox(task: Task) {
    await unscheduleTask(task.id);
    syncAfterWrite();
  }

  function openDetail(task: Task) {
    setDetailId(task.id);
    setError(null);
  }

  const isOverdue = (t: Task) => {
    const p = placementForTask(t, new Date());
    return p.pool === "today" && p.overdue;
  };

  function renderSection(title: string, tasks: Task[], pool: "today" | "inbox" | "upcoming", badge?: string) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <span className="text-xs text-slate-500">{badge ?? tasks.length}</span>
        </div>
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">
            {pool === "inbox" ? "收件箱为空" : pool === "today" ? "今天没有任务 🎉" : "暂无即将到来的任务"}
          </p>
        ) : (
          <SwipeableList type={ListType.IOS} fullSwipe={false} className="space-y-2">
            {tasks.map((task) => (
              <SwipeableTaskRow key={task.id} task={task} pool={pool}
                overdue={pool === "today" && isOverdue(task)}
                onToggle={toggle} onEdit={openDetail} onDelete={remove}
                onToToday={moveToToday} onToInbox={moveToInbox} />
            ))}
          </SwipeableList>
        )}
      </section>
    );
  }

  return (
    <div className="min-h-full bg-slate-950 px-4 py-4 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* 快速输入 */}
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
              disabled={saving || !draftTitle.trim()}
              className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              今天
            </button>
            <button
              type="button"
              disabled={saving || !draftTitle.trim()}
              onClick={(e) => { e.preventDefault(); submitToInbox(e as unknown as FormEvent<HTMLFormElement>); }}
              className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm text-slate-300 disabled:opacity-60"
            >
              收纳
            </button>
          </div>
          <RecurrenceEditor value={draftRecurrence} onChange={setDraftRecurrence} />
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </form>

        {/* 今天 */}
        {renderSection("今天", buckets.today, "today")}

        {/* 即将到来 */}
        {buckets.upcoming.length > 0 && (
          <details open={showUpcoming} onToggle={(e) => setShowUpcoming((e.target as HTMLDetailsElement).open)}>
            <summary className="flex cursor-pointer items-center justify-between py-1 text-base font-semibold text-slate-100">
              <span>即将到来</span>
              <span className="text-xs text-slate-500">{buckets.upcoming.length}</span>
            </summary>
            <div className="mt-2">
              <SwipeableList type={ListType.IOS} fullSwipe={false} className="space-y-2">
                {buckets.upcoming.map((task) => (
                  <SwipeableTaskRow key={task.id} task={task} pool="upcoming"
                    onToggle={toggle} onEdit={openDetail} onDelete={remove}
                    onToToday={moveToToday} onToInbox={moveToInbox} />
                ))}
              </SwipeableList>
            </div>
          </details>
        )}

        {/* 收件箱 */}
        {renderSection("收件箱", buckets.inbox, "inbox")}

        {/* 重复任务 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">重复任务</h2>
            <span className="text-xs text-slate-500">{buckets.recurring.length}</span>
          </div>
          {buckets.recurring.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">暂无重复任务</p>
          ) : (
            <ul className="space-y-2">
              {buckets.recurring.map((task) => {
                const recurrence = task.recurrence;
                if (!recurrence) return null;
                const due = isDueNow(recurrence, task.lastDoneAt, task.startAt);
                const checked = !due;
                return (
                  <li key={task.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox" aria-label={`完成 ${task.title}`}
                        checked={checked} onChange={() => toggle(task)}
                        className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                      />
                      <div className="min-w-0 flex-1" onClick={() => openDetail(task)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") openDetail(task); }}>
                        <div className="break-words text-sm font-medium text-slate-100">{task.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{recurrenceSummary(recurrence)}</span>
                          {recurrence.count != null && <span>完成 {task.completedCount}/{recurrence.count}</span>}
                          <span className={due ? "text-amber-300" : "text-emerald-300"}>{due ? "待做" : "已完成"}</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => openDetail(task)}
                        className="min-h-8 rounded-lg border border-slate-700 px-2 text-xs text-slate-300">编辑</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {detailId && <TaskDetailSheet id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
