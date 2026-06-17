import type { Recurrence } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { normalizeScheduledDate } from "../../lib/tasks/placement.js";
import { recurrenceToCustomInput } from "../../lib/tasks/recurrencePresets.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import { applyRecurrenceChoice, deleteTask, toggleTaskDone, updateSubtasks, updateTask } from "../../lib/tasks.js";
import { getDateString } from "../../lib/time.js";
import { CustomRecurrencePage } from "./CustomRecurrencePage.js";
import { RecurrencePresetSheet } from "./RecurrencePresetSheet.js";
import { SubtaskEditor } from "./SubtaskEditor.js";
import { useSubtaskDraft } from "./useSubtaskDraft.js";

interface TaskDetailSheetProps {
  id: string | null;
  onClose: () => void;
}

const SWIPE_CLOSE_THRESHOLD = 60;
const DEFAULT_RECURRENCE: Recurrence = { freq: "daily", interval: 1, basis: "due" };

/** 下滑位移（px，向下为正）是否达到关闭阈值。 */
export function isSwipeDownClose(deltaY: number): boolean {
  return deltaY > SWIPE_CLOSE_THRESHOLD;
}

function autoGrowTitle(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function TaskDetailSheet({ id, onClose }: TaskDetailSheetProps) {
  const task = useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
  const { syncAfterWrite } = useSyncContext();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<"none" | "preset" | "custom">("none");
  const touchStartY = useRef<number | null>(null);
  const hadTask = useRef(false);

  // 只在切换任务时初始化 draft，避免同步刷新覆盖用户正在编辑的内容。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅按 task.id 重置是有意的
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setError(null);
    setOverlay("none");
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

  const {
    subtasks,
    onChange: handleSubtasksChange,
    onBlur: blurSubtasks,
  } = useSubtaskDraft({
    taskId: task?.id ?? "",
    externalSubtasks: task?.subtasks ?? [],
    onCommit: (next) => {
      if (!id) return;
      void run(() => updateSubtasks(id, next));
    },
  });

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
    }
    onClose();
  }

  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const todayDate = getDateString(new Date());
  const anchorDate = task?.startAt ? getDateString(new Date(task.startAt)) : todayDate;
  const nextTimeLabel = task ? taskTimeLabel(task) : "设定时间";
  const customInitial = useMemo(
    () =>
      task
        ? recurrenceToCustomInput(task.recurrence ?? DEFAULT_RECURRENCE, task.startAt, anchorDate)
        : recurrenceToCustomInput(DEFAULT_RECURRENCE, null, todayDate),
    [anchorDate, task, todayDate],
  );

  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (overlayRef.current !== "none") {
          setOverlay(overlayRef.current === "custom" ? "preset" : "none");
          return;
        }
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
              <Checkbox
                ariaLabel={`完成 ${task.title}`}
                checked={task.done}
                onChange={() => void run(() => toggleTaskDone(task.id))}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label="编辑重复与时间"
                    onClick={() => setOverlay("preset")}
                    className="min-h-8 rounded-full bg-slate-800/80 px-3 text-xs text-sky-100 hover:bg-slate-700"
                  >
                    {nextTimeLabel}
                  </button>
                  {subtaskTotal > 0 && (
                    <span className="text-xs text-ink-3">
                      {subtaskDone}/{subtaskTotal}
                    </span>
                  )}
                </div>
                <textarea
                  aria-label="任务标题"
                  value={title}
                  rows={1}
                  ref={(el) => autoGrowTitle(el)}
                  onChange={(event) => {
                    setTitle(event.currentTarget.value);
                    autoGrowTitle(event.currentTarget);
                  }}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="任务标题"
                  className="w-full resize-none break-words bg-transparent py-2 text-xl font-medium leading-relaxed text-ink outline-none placeholder:text-ink-3"
                />
              </div>
            </div>

            <div onBlur={blurSubtasks}>
              <SubtaskEditor value={subtasks} onChange={handleSubtasksChange} density="full" />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                aria-label="删除任务"
                onClick={handleDelete}
                className="min-h-9 rounded-lg px-3 text-sm text-rose-300 hover:bg-rose-950/40"
              >
                删除
              </button>
            </div>
          </div>
        )}
      </div>
      {task && overlay === "preset" && (
        <RecurrencePresetSheet
          current={task.recurrence}
          scheduledAt={task.scheduledAt ?? null}
          anchor={anchorDate}
          onChoose={(choice) => {
            setOverlay("none");
            void run(() => applyRecurrenceChoice(task.id, choice));
          }}
          onCustom={() => setOverlay("custom")}
          onClose={() => setOverlay("none")}
        />
      )}
      {task && overlay === "custom" && (
        <CustomRecurrencePage
          initial={customInitial}
          onBack={() => setOverlay("preset")}
          onComplete={(recurrence, startDate) => {
            setOverlay("none");
            void run(() => updateTask(task.id, { recurrence, startAt: normalizeScheduledDate(startDate) }));
          }}
        />
      )}
    </div>
  );
}
