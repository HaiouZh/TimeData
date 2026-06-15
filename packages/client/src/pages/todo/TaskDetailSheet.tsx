import { useEffect, useRef, useState } from "react";
import type { Recurrence, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { RecurrenceEditor } from "../../components/RecurrenceEditor.js";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { getDateString } from "../../lib/time.js";
import { deleteTask, scheduleTask, toggleTaskDone, unscheduleTask, updateSubtasks, updateTask } from "../../lib/tasks.js";
import { recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { subtasksDifferStructurally, trimSubtasks } from "../../lib/tasks/subtasks.js";
import { SubtaskEditor } from "./SubtaskEditor.js";

interface TaskDetailSheetProps {
  id: string | null;
  onClose: () => void;
}

const SWIPE_CLOSE_THRESHOLD = 60;

/** 下滑位移（px，向下为正）是否达到关闭阈值。 */
export function isSwipeDownClose(deltaY: number): boolean {
  return deltaY > SWIPE_CLOSE_THRESHOLD;
}

export function TaskDetailSheet({ id, onClose }: TaskDetailSheetProps) {
  const task = useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
  const { syncAfterWrite } = useSyncContext();
  const [title, setTitle] = useState("");
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const hadTask = useRef(false);

  // 只在切换任务时初始化 draft，避免同步刷新覆盖用户正在编辑的内容。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅按 task.id 重置是有意的
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setSubtasks(task.subtasks ?? []);
    setError(null);
    setTimeOpen(false);
  }, [task?.id]);

  useEffect(() => {
    if (task) {
      hadTask.current = true;
    } else if (id && hadTask.current) {
      onClose();
    }
  }, [task, id, onClose]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      setError(null);
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function commitTitle(): void {
    if (!id) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === task?.title) return;
    void run(() => updateTask(id, { title: trimmed }));
  }

  function commitSubtasks(list: TaskSubtask[]): void {
    if (!id) return;
    void run(() => updateSubtasks(id, trimSubtasks(list)));
  }

  function handleSubtasksChange(next: TaskSubtask[]): void {
    const structural = subtasksDifferStructurally(subtasks, next);
    setSubtasks(next);
    if (structural) commitSubtasks(next);
  }

  function handleRecurrenceChange(recurrence: Recurrence | null): void {
    if (!id) return;
    void run(() => updateTask(id, { recurrence }));
  }

  function handleDelete(): void {
    if (!id) return;
    void (async () => {
      try {
        await deleteTask(id);
        syncAfterWrite();
        onClose();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }

  function handleClose(): void {
    if (id && task) {
      const trimmed = title.trim();
      if (trimmed && trimmed !== task.title) {
        void run(() => updateTask(id, { title: trimmed }));
      }

      const trimmedSubtasks = trimSubtasks(subtasks);
      if (JSON.stringify(trimmedSubtasks) !== JSON.stringify(task.subtasks ?? [])) {
        commitSubtasks(subtasks);
      }
    }
    onClose();
  }

  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const nextTimeLabel = task
    ? (task.recurrence ? recurrenceSummary(task.recurrence) : (task.scheduledAt ? getDateString(new Date(task.scheduledAt)) : "设定时间"))
    : "设定时间";
  const scheduledDate = task?.scheduledAt ? getDateString(new Date(task.scheduledAt)) : "";

  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="任务详情"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        data-testid="detail-sheet"
        className={`flex w-full max-w-2xl flex-col rounded-t-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl ${expanded ? "h-[90vh]" : "max-h-[calc(90vh)]"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onTouchStart={(event) => {
          touchStartY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartY.current;
          touchStartY.current = null;
          const end = event.changedTouches[0]?.clientY ?? start ?? 0;
          if (start != null && isSwipeDownClose(end - start)) {
            handleClose();
          }
        }}
      >
        <div className="relative flex items-center justify-center py-3">
          <button type="button" aria-label="关闭" onClick={handleClose} className="flex justify-center">
            <span className="block h-1 w-10 rounded-full bg-slate-600" />
          </button>
          <button
            type="button"
            aria-label={expanded ? "还原" : "放大"}
            onClick={() => setExpanded((value) => !value)}
            className="absolute right-3 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            {expanded ? "▢" : "⤢"}
          </button>
        </div>

        {error && <p className="px-4 pb-2 text-sm text-rose-300">{error}</p>}

        {task && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`完成 ${task.title}`}
                checked={task.done}
                onChange={() => void run(() => toggleTaskDone(task.id))}
                className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div>
                  <button
                    type="button"
                    aria-label="编辑下一次时间"
                    onClick={() => setTimeOpen((value) => !value)}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    {nextTimeLabel}
                  </button>
                  {subtaskTotal > 0 && <span className="text-xs text-slate-400"> / {subtaskDone}/{subtaskTotal} 子任务</span>}
                </div>
                <input
                  aria-label="任务标题"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  onBlur={commitTitle}
                  placeholder="任务标题"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-base text-slate-100 outline-none focus:border-sky-500"
                />
                {timeOpen && (
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                    {!task.recurrence && (
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        计划日期
                        <input
                          type="date"
                          aria-label="计划日期"
                          value={scheduledDate}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            void run(() => (value ? scheduleTask(task.id, value) : unscheduleTask(task.id)));
                          }}
                          className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                      </label>
                    )}
                    <RecurrenceEditor value={task.recurrence} onChange={handleRecurrenceChange} />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3" onBlur={() => commitSubtasks(subtasks)}>
              <p className="mb-2 text-xs font-medium text-slate-400">子任务</p>
              <SubtaskEditor value={subtasks} onChange={handleSubtasksChange} />
            </div>

            <button
              type="button"
              aria-label="删除任务"
              onClick={handleDelete}
              className="min-h-10 w-full rounded-lg border border-rose-800 text-sm text-rose-300 hover:bg-rose-900/30"
            >
              删除任务
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
