import type { FormEvent } from "react";
import { useState } from "react";
import type { Recurrence, Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { SwipeableList, Type as ListType } from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import { RecurrenceEditor } from "../components/RecurrenceEditor.js";
import { BOTTOM_NAV_HEIGHT_PX } from "../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import {
  addTask, deleteTask, listTasks, scheduleTask, toggleTaskDone,
  unscheduleTask, type TodoBuckets,
} from "../lib/tasks.js";
import { isDueNow } from "../lib/tasks/recurrence.js";
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
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 pb-48">
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

        {/* Repeat / InBox 合并横栏 */}
        <RepeatInboxPanel
          inbox={buckets.inbox}
          recurring={buckets.recurring}
          toggle={toggle}
          openDetail={openDetail}
          remove={remove}
          moveToToday={moveToToday}
          moveToInbox={moveToInbox}
        />
      </div>

      {/* 底部 composer：默认进今天，「重复」勾选展开配置 */}
      <form
        onSubmit={submit}
        className="fixed left-0 right-0 max-h-[70vh] overflow-y-auto border-t border-slate-800/80 bg-slate-950/95 p-2 backdrop-blur sm:p-3"
        style={{ bottom: BOTTOM_NAV_HEIGHT_PX }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-2">
          <div className="flex gap-2">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder="添加任务…"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <label className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-300">
              <input
                type="checkbox"
                aria-label="重复"
                checked={draftRecurrence !== null}
                onChange={(event) =>
                  setDraftRecurrence(event.currentTarget.checked ? { freq: "daily", interval: 1, basis: "due" } : null)
                }
                className="h-4 w-4 accent-sky-500"
              />
              重复
            </label>
            <button
              type="submit"
              disabled={saving || !draftTitle.trim()}
              className="min-h-11 shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              今天
            </button>
          </div>
          {draftRecurrence && <RecurrenceEditor value={draftRecurrence} onChange={setDraftRecurrence} />}
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </div>
      </form>

      {detailId && <TaskDetailSheet id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function RepeatInboxPanel(props: {
  inbox: Task[];
  recurring: Task[];
  toggle: (task: Task) => void;
  openDetail: (task: Task) => void;
  remove: (task: Task) => void;
  moveToToday: (task: Task) => void;
  moveToInbox: (task: Task) => void;
}) {
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(true);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Repeat，${props.recurring.length} 项`}
          aria-expanded={repeatOpen}
          onClick={() => setRepeatOpen((open) => !open)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${repeatOpen ? "border-sky-600 bg-sky-950/40 text-sky-200" : "border-slate-700 text-slate-300"}`}
        >
          Repeat <span className="text-xs text-slate-500">{props.recurring.length}</span>
        </button>
        <button
          type="button"
          aria-label={`InBox，${props.inbox.length} 项`}
          aria-expanded={inboxOpen}
          onClick={() => setInboxOpen((open) => !open)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${inboxOpen ? "border-sky-600 bg-sky-950/40 text-sky-200" : "border-slate-700 text-slate-300"}`}
        >
          InBox <span className="text-xs text-slate-500">{props.inbox.length}</span>
        </button>
      </div>

      {repeatOpen && (
        <div data-panel="repeat" className="space-y-2">
          {props.recurring.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">暂无重复任务</p>
          ) : (
            <ul className="space-y-2">
              {props.recurring.map((task) => {
                const recurrence = task.recurrence;
                if (!recurrence) return null;
                const checked = !isDueNow(recurrence, task.lastDoneAt, task.startAt);
                return (
                  <li key={task.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`完成 ${task.title}`}
                        checked={checked}
                        onChange={() => props.toggle(task)}
                        className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                      />
                      <div
                        className="min-w-0 flex-1"
                        onClick={() => props.openDetail(task)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") props.openDetail(task);
                        }}
                      >
                        <div className="break-words text-sm font-medium text-slate-100">{task.title}</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {inboxOpen && (
        <div data-panel="inbox" className="space-y-2">
          {props.inbox.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">收件箱为空</p>
          ) : (
            <SwipeableList type={ListType.IOS} fullSwipe={false} className="space-y-2">
              {props.inbox.map((task) => (
                <SwipeableTaskRow
                  key={task.id}
                  task={task}
                  pool="inbox"
                  onToggle={props.toggle}
                  onEdit={props.openDetail}
                  onDelete={props.remove}
                  onToToday={props.moveToToday}
                  onToInbox={props.moveToInbox}
                />
              ))}
            </SwipeableList>
          )}
        </div>
      )}
    </section>
  );
}
