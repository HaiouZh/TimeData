import { Trash, X } from "@phosphor-icons/react";
import type { Recurrence, Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { normalizeScheduledDate, placementForTask } from "../../lib/tasks/placement.js";
import { recurrenceToCustomInput } from "../../lib/tasks/recurrencePresets.js";
import { subtaskProgress } from "../../lib/tasks/subtasks.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import {
  applyRecurrenceChoice,
  deleteTaskCascade,
  markOccurrenceSkipped,
  toggleTaskDone,
  updateTask,
} from "../../lib/tasks.js";
import { getDateString } from "../../lib/time.js";
import { CustomRecurrencePage } from "./CustomRecurrencePage.js";
import { InlineChildren } from "./InlineChildren.js";
import { RecurrencePresetSheet } from "./RecurrencePresetSheet.js";
import { useTaskChildren } from "./useTaskChildren.js";

interface TaskDetailSheetProps {
  id: string | null;
  onClose: () => void;
  onTagsChange?: (task: Task, tags: string[]) => void;
}

const SWIPE_CLOSE_THRESHOLD = 60;
const DEFAULT_RECURRENCE: Recurrence = { freq: "daily", interval: 1, basis: "due" };
const EMPTY_TAGS: string[] = [];

/** 下滑位移（px，向下为正）是否达到关闭阈值。 */
export function isSwipeDownClose(deltaY: number): boolean {
  return deltaY > SWIPE_CLOSE_THRESHOLD;
}

function autoGrowTitle(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function TaskDetailSheet({ id, onClose, onTagsChange }: TaskDetailSheetProps) {
  const task = useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
  const { syncAfterWrite } = useSyncContext();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<"none" | "preset" | "custom">("none");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const touchStartY = useRef<number | null>(null);
  const hadTask = useRef(false);
  const lastSeenRemoteTags = useRef<string[] | null>(null);
  const taskTags = task?.tags ?? EMPTY_TAGS;

  // 只在切换任务时初始化 draft，避免同步刷新覆盖用户正在编辑的内容。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅按 task.id 重置是有意的
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setError(null);
    setOverlay("none");
    setTags(task.tags ?? []);
    setTagDraft("");
    lastSeenRemoteTags.current = task.tags ?? [];
  }, [task?.id]);

  // 远端推送 task.tags 时同步本地——但只在「远端值真的变了」时（不是本地 commit 后 LiveQuery 回流），
  // 否则会反复把本地 state 刷回旧值。lastSeenRemoteTags 记上次见过的远端值，对比后再决定。
  useEffect(() => {
    if (!task) return;
    const remote = taskTags;
    const last = lastSeenRemoteTags.current;
    const same = last !== null && last.length === remote.length && last.every((t, i) => t === remote[i]);
    if (same) return;
    lastSeenRemoteTags.current = remote;
    // 用户在敲（draft 非空）时不打断输入；本地 state 留给用户提交后下一轮同步。
    if (tagDraft !== "") return;
    setTags(remote);
  }, [task, taskTags, tagDraft]);

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
    const normalized = normalizeTitle(title);
    if (normalized !== title) setTitle(normalized || (task?.title ?? ""));
    if (!normalized || normalized === task?.title) return;
    void run(() => updateTask(id, { title: normalized }));
  }

  const childRows = useTaskChildren(task?.id ?? null);
  // child 模式下隐藏高级控件入口（recurrence/tags/scheduledAt 等）。
  const isChild = task ? task.parentId !== null : false;

  function commitTagAdd(): void {
    if (!task || !onTagsChange) return;
    const next = (tagDraft || "").trim();
    if (!next || next.length > 64) {
      setTagDraft("");
      return;
    }
    if (tags.includes(next)) {
      setTagDraft("");
      return;
    }
    if (tags.length >= 50) {
      setTagDraft("");
      return;
    }
    const updated = [...tags, next];
    setTags(updated);
    onTagsChange(task, updated);
    setTagDraft("");
  }

  function removeTag(tag: string): void {
    if (!task || !onTagsChange) return;
    const updated = tags.filter((t) => t !== tag);
    setTags(updated);
    onTagsChange(task, updated);
  }

  function handleDelete(): void {
    if (!id || !task) return;
    void (async () => {
      try {
        if (task.ruleId !== null && !task.done && !task.skipped) {
          await markOccurrenceSkipped(id);
        } else {
          await deleteTaskCascade(id);
        }
        syncAfterWrite();
        onClose();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }

  function handleClose(): void {
    if (id && task) {
      const normalized = normalizeTitle(title);
      if (normalized !== title) setTitle(normalized || task.title);
      if (normalized && normalized !== task.title) {
        void run(() => updateTask(id, { title: normalized }));
      }
    }
    onClose();
  }

  const subtaskTotal = childRows.length;
  const subtaskDone = childRows.filter((c) => c.done).length;
  const processedOccurrences =
    useLiveQuery(
      () =>
        task?.recurrence
          ? db.tasks.where("ruleId").equals(task.id).toArray()
          : Promise.resolve([] as Task[]),
      [task?.id, task?.recurrence !== null],
      [] as Task[],
    ) ?? [];
  const todayDate = getDateString(new Date());
  const taskPlacement = task ? placementForTask(task, new Date()) : null;
  const anchorDate =
    task?.recurrence && taskPlacement?.pool === "today" && taskPlacement.overdue
      ? todayDate
      : task?.startAt
        ? getDateString(new Date(task.startAt))
        : todayDate;
  const nextTimeLabel = task ? taskTimeLabel(task, processedOccurrences) : "设定时间";
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
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        data-testid="detail-sheet"
        className={`flex w-full max-w-2xl flex-col rounded-t-2xl border border-border-hairline bg-surface-elevated text-ink shadow-2xl ${expanded ? "h-[90vh]" : "max-h-[calc(90vh)]"}`}
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
            <span className="block h-1 w-10 rounded-full bg-ink-3" />
          </button>
          <button
            type="button"
            aria-label={expanded ? "还原" : "放大"}
            onClick={() => setExpanded((value) => !value)}
            className="absolute right-3 rounded-ctl px-2 py-1 text-xs text-ink-3 hover:bg-surface-hover"
          >
            {expanded ? "▢" : "⤢"}
          </button>
        </div>

        {task && subtaskTotal > 0 && (
          <div data-testid="subtask-progress" className="h-[3px] w-full bg-surface-hover" aria-hidden="true">
            <div
              data-testid="subtask-progress-fill"
              className={`h-full transition-all ${subtaskDone === subtaskTotal ? "bg-ok" : "bg-accent-strong"}`}
              style={{ width: `${(subtaskProgress(subtaskDone, subtaskTotal) ?? 0) * 100}%` }}
            />
          </div>
        )}

        {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}

        {task && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <div className="flex items-start gap-3">
              <Checkbox
                ariaLabel={`完成 ${task.title}`}
                checked={task.recurrence ? false : task.done}
                onChange={() => {
                  if (!task.recurrence) void run(() => toggleTaskDone(task.id));
                }}
                disabled={task.recurrence !== null}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isChild ? (
                    <span className="inline-flex min-h-8 items-center rounded-ctl bg-surface-hover px-2 py-0.5 text-xs text-ink-3">
                      作为子任务
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label="编辑重复与时间"
                      onClick={() => setOverlay("preset")}
                      className="inline-flex min-h-8 items-center rounded-ctl bg-surface-hover px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-elevated"
                    >
                      {nextTimeLabel}
                    </button>
                  )}
                  {subtaskTotal > 0 && (
                    <span className="text-xs text-ink-3">
                      <span aria-hidden="true">
                        {subtaskDone}/{subtaskTotal}
                      </span>
                      <span className="sr-only">
                        已完成 {subtaskDone} 个，共 {subtaskTotal} 个子任务
                      </span>
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
                    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="任务标题"
                  className="w-full resize-none break-words bg-transparent py-2 text-xl font-medium leading-relaxed text-ink outline-none placeholder:text-ink-3"
                />
              </div>
            </div>

            {!isChild && task && <InlineChildren parentId={task.id} mode="draggable" onAfterWrite={syncAfterWrite} />}

            {!isChild && onTagsChange && task && (
              <div data-testid="tag-editor" className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      data-testid="tag-edit-chip"
                      className="inline-flex items-center gap-1 rounded-pill bg-surface-hover px-2 py-0.5 text-xs text-ink-2"
                    >
                      #{tag}
                      <button
                        type="button"
                        aria-label={`删除标签 ${tag}`}
                        onClick={() => removeTag(tag)}
                        className="text-ink-3 hover:text-danger"
                      >
                        <Icon icon={X} size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  aria-label="添加标签"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTagAdd();
                    }
                  }}
                  onBlur={commitTagAdd}
                  placeholder="加标签，回车确认"
                  className="w-full rounded-ctl border border-border-hairline bg-surface px-2 py-1 text-sm text-ink outline-none"
                />
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                aria-label="删除任务"
                onClick={handleDelete}
                className="flex h-11 w-11 items-center justify-center rounded-ctl text-ink-3 hover:bg-danger-soft hover:text-danger"
              >
                <Icon icon={Trash} size={18} />
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
