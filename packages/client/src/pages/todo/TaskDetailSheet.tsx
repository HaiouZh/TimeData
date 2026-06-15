import { useEffect, useRef, useState } from "react";
import type { Recurrence, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { RecurrenceEditor } from "../../components/RecurrenceEditor.js";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { deleteTask, updateSubtasks, updateTask } from "../../lib/tasks.js";
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
  const touchStartY = useRef<number | null>(null);
  const hadTask = useRef(false);

  // 只在切换任务时初始化 draft，避免同步刷新覆盖用户正在编辑的内容。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅按 task.id 重置是有意的
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setSubtasks(task.subtasks ?? []);
    setError(null);
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
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl"
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
        <button type="button" aria-label="关闭" onClick={handleClose} className="flex w-full justify-center py-3">
          <span className="block h-1 w-10 rounded-full bg-slate-600" />
        </button>

        {error && <p className="px-4 pb-2 text-sm text-rose-300">{error}</p>}

        {task && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <input
              aria-label="任务标题"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onBlur={commitTitle}
              placeholder="任务标题"
              className="min-h-11 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-base text-slate-100 outline-none focus:border-sky-500"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3" onBlur={() => commitSubtasks(subtasks)}>
              <p className="mb-2 text-xs font-medium text-slate-400">子任务</p>
              <SubtaskEditor value={subtasks} onChange={handleSubtasksChange} />
            </div>

            <RecurrenceEditor value={task.recurrence} onChange={handleRecurrenceChange} />

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
