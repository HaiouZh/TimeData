import { HandGrabbing, Trash, X } from "@phosphor-icons/react";
import { nextDueDate, type Recurrence, type Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { db } from "../../db/index.js";
import { contentTint } from "../../lib/contentTint.js";
import { getActiveSession, grabTaskToHand, releaseTaskFromHand } from "../../lib/sessions.js";
import { normalizeScheduledDate } from "../../lib/tasks/placement.js";
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
  /**
   * 「重复与时间」写入成功后把**写入结果**交出去，供页面判落点（成员回落 inbox 池要展开归属组）。
   *
   * 抽屉只报告事实、不判落点：`choice.kind` 是代理判据，两个方向都错——「仅某天」可以选过去的日期
   * （一次性任务过期照样回落 inbox 池），而「不重复」落在已完成 / 手头的任务根本不去 inbox 池。
   * 落点判据统一在 TodoPage 的 revealProjectHome 一处判。
   */
  onTimeChanged?: (task: Task) => void;
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

export function TaskDetailSheet({ id, onClose, onTagsChange, onTimeChanged }: TaskDetailSheetProps) {
  const task = useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
  const activeSession = useLiveQuery(() => getActiveSession(), []) ?? null;
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

  /** 成功返回写入结果，失败把消息落进 error 并返回 undefined（**照常 resolve**，调用方据返回值区分成败）。 */
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await fn();
      setError(null);
      return value;
    } catch (err) {
      setError((err as Error).message);
      return undefined;
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

  const inHand = activeSession !== null && task?.sessionId === activeSession.id;
  const canGrab = task ? (task.parentId ?? null) === null && task.recurrence === null && !task.done : false;

  const handleHand = async () => {
    if (!task) return;
    if (inHand) await releaseTaskFromHand(task.id);
    else await grabTaskToHand(task.id);
  };

  function handleDelete(): void {
    if (!id || !task) return;
    void (async () => {
      try {
        // occurrence 一律留痕（done / 已 skipped 也是）：硬删会让游标回退，
        // 引擎下一轮用确定性 id occ:{ruleId}:{dueDate} 把这发重新物化成未勾选。
        // recurrence===null 是 markOccurrenceSkipped 的前置条件，混合体行仍走 cascade 兜底不至于删不掉。
        if (task.ruleId !== null && task.recurrence === null) {
          await markOccurrenceSkipped(id);
        } else {
          await deleteTaskCascade(id);
        }
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
  // 从 occurrence 打开时，重复编辑的目标是它的规则模板（occurrence 自身 recurrence 恒为 null）。
  // 「加载中」不能用 useLiveQuery 返回 undefined 来判：它的 monitor 是 useRef，deps 变化时不重置，
  // 一旦产出过结果就跳过同步窥值，deps 变更那帧会返回**上一次订阅的陈旧值**。故让结果自带
  // 「它是为哪个 ruleId 算的」，靠比对判新鲜度；陈旧结果一律当加载中，避免闪一帧假孤儿文案。
  const ruleQuery = useLiveQuery(
    async () => ({
      forRuleId: task?.ruleId ?? null,
      rule: task?.ruleId ? await db.tasks.get(task.ruleId) : undefined,
    }),
    [task?.ruleId],
  );
  const ruleFresh = ruleQuery?.forRuleId === (task?.ruleId ?? null);
  const rule = ruleFresh ? ruleQuery?.rule : undefined;
  // 真 occurrence：有 ruleId 且自身不带 recurrence。混合体行（两者都非空）不算——它仍指向自己，
  // 保留「打开预设选不重复清掉 recurrence」这条就地自愈路径。
  const isOccurrence = (task?.ruleId ?? null) !== null && (task?.recurrence ?? null) === null;
  // 孤儿 occurrence：ruleId 指向已不存在的模板。此时绝不回退到 task 自己——
  // 回退会让「编辑重复与时间」把 recurrence 写进 occurrence，就地造出 ruleId × recurrence 混合体行。
  const orphanOccurrence = isOccurrence && ruleFresh && rule === undefined;
  const recurrenceTarget: Task | null = isOccurrence ? (rule ?? null) : (task ?? null);
  const ruleOccurrences =
    useLiveQuery(
      () =>
        recurrenceTarget?.recurrence
          ? db.tasks.where("ruleId").equals(recurrenceTarget.id).toArray()
          : Promise.resolve([] as Task[]),
      [recurrenceTarget?.id, recurrenceTarget?.recurrence !== null],
      [] as Task[],
    ) ?? [];
  const todayDate = getDateString(new Date());
  // 锚点=未完成的最近一发：优先活跃 pending occurrence 的应发生日，否则按账本推下一发。
  const pendingOccurrence = ruleOccurrences.find((o) => !o.done && !o.skipped) ?? null;
  const nextDue = recurrenceTarget?.recurrence ? nextDueDate(recurrenceTarget, ruleOccurrences, new Date()) : null;
  const anchorDate = recurrenceTarget?.recurrence
    ? pendingOccurrence?.scheduledAt
      ? getDateString(new Date(pendingOccurrence.scheduledAt))
      : (nextDue ?? todayDate)
    : task?.startAt
      ? getDateString(new Date(task.startAt))
      : todayDate;
  const nextTimeLabel = recurrenceTarget ? taskTimeLabel(recurrenceTarget, ruleOccurrences) : "设定时间";
  // 规则模板勾选=代理完成最新一发；未到期时也允许人工提前完成，无下一发（耗尽）才置灰。
  const ruleCanComplete = task?.recurrence ? pendingOccurrence != null || nextDue != null : false;
  const customInitial = useMemo(
    () =>
      recurrenceTarget
        ? recurrenceToCustomInput(
            recurrenceTarget.recurrence ?? DEFAULT_RECURRENCE,
            recurrenceTarget.recurrence ? null : recurrenceTarget.startAt,
            anchorDate,
          )
        : recurrenceToCustomInput(DEFAULT_RECURRENCE, null, todayDate),
    [anchorDate, recurrenceTarget, todayDate],
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
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-backdrop/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        data-testid="detail-sheet"
        className={`flex w-full max-w-2xl flex-col rounded-t-card border border-border-hairline bg-surface-elevated text-ink shadow-2xl ${expanded ? "task-detail-sheet-expanded" : "task-detail-sheet"}`}
        style={{ paddingBottom: "var(--safe-bottom)" }}
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
            <span className="block h-1 w-10 rounded-pill bg-ink-3" />
          </button>
          <button
            type="button"
            aria-label={expanded ? "还原" : "放大"}
            onClick={() => setExpanded((value) => !value)}
            className="absolute right-3 rounded-ctl px-2 py-1 td-text-caption text-ink-3 hover:bg-surface-hover"
          >
            {expanded ? "▢" : "⤢"}
          </button>
        </div>

        {task && subtaskTotal > 0 && (
          <div data-testid="subtask-progress" className="task-subtask-progress w-full bg-surface-hover" aria-hidden="true">
            <div
              data-testid="subtask-progress-fill"
              className={`h-full transition-all ${subtaskDone === subtaskTotal ? "bg-ok" : "bg-accent-strong"}`}
              style={{ width: `${(subtaskProgress(subtaskDone, subtaskTotal) ?? 0) * 100}%` }}
            />
          </div>
        )}

        {error && <p className="px-4 pb-2 td-text-label text-danger">{error}</p>}

        {task && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <div className="flex items-start gap-3">
              <Checkbox
                ariaLabel={`完成 ${task.title}`}
                checked={task.recurrence ? false : task.done}
                onChange={() => {
                  if (!task.recurrence || ruleCanComplete) void run(() => toggleTaskDone(task.id));
                }}
                disabled={task.recurrence !== null && !ruleCanComplete}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isChild ? (
                    <span className="inline-flex min-h-8 items-center rounded-ctl bg-surface-hover px-2 py-0.5 td-text-caption text-ink-3">
                      作为子任务
                    </span>
                  ) : recurrenceTarget ? (
                    <button
                      type="button"
                      aria-label="编辑重复与时间"
                      onClick={() => setOverlay("preset")}
                      className="inline-flex min-h-8 items-center rounded-ctl bg-surface-hover px-2 py-0.5 td-text-caption text-ink-2 hover:bg-surface-elevated"
                    >
                      {nextTimeLabel}
                    </button>
                  ) : orphanOccurrence ? (
                    // 模板没了就没有可编辑的重复规则；给静态说明而不是可点入口，避免把 recurrence 写回这一发。
                    <span className="inline-flex min-h-8 items-center rounded-ctl bg-surface-hover px-2 py-0.5 td-text-caption text-ink-3">
                      重复规则已删除，不能在这里改
                    </span>
                  ) : null}
                  {subtaskTotal > 0 && (
                    <span className="td-text-caption text-ink-3">
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
                  className="w-full resize-none break-words bg-transparent py-2 font-medium leading-relaxed text-ink outline-none placeholder:text-ink-3"
                />
              </div>
            </div>

            {!isChild && task && <InlineChildren parentId={task.id} mode="draggable" />}

            {!isChild && onTagsChange && task && (
              <div data-testid="tag-editor" className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      data-testid="tag-edit-chip"
                      className="inline-flex items-center gap-1 rounded-pill bg-surface-hover px-2 py-0.5 td-text-caption text-ink-2"
                    >
                      {/* `#` 着色与任务行同构：这里是增删标签的入口，改完回到行上必须是同一个色 */}
                      <span data-tag-hash style={{ color: contentTint(tag) }}>
                        #
                      </span>
                      {tag}
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
                  className="w-full rounded-ctl border border-border-hairline bg-surface px-2 py-1 text-ink outline-none"
                />
              </div>
            )}

            <div className="flex justify-end">
              {canGrab && (
                <button
                  type="button"
                  aria-label={inHand ? "移出手头" : "抓到手头"}
                  onClick={() => void handleHand()}
                  className="flex h-11 w-11 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-accent"
                >
                  <Icon icon={HandGrabbing} size={18} />
                </button>
              )}
              <button
                type="button"
                aria-label="删除任务"
                onClick={handleDelete}
                className="flex h-11 w-11 items-center justify-center rounded-ctl text-ink-3 hover:bg-danger/15 hover:text-danger"
              >
                <Icon icon={Trash} size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
      {recurrenceTarget && overlay === "preset" && (
        <RecurrencePresetSheet
          current={recurrenceTarget.recurrence}
          scheduledAt={recurrenceTarget.scheduledAt ?? null}
          anchor={anchorDate}
          onChoose={(choice) => {
            const targetId = recurrenceTarget.id;
            setOverlay("none");
            void (async () => {
              // 只有写入成功才报：run() 把异常吞进 error 后照常 resolve，挂 .then() 等于「不管成败都报」——
              // 任务被并发删除时会一边弹错一边把页面滚去展开一个空组（查归属认 members 原始事实，不校验行还在不在）。
              const next = await run(() => applyRecurrenceChoice(targetId, choice));
              if (next) onTimeChanged?.(next);
            })();
          }}
          onCustom={() => setOverlay("custom")}
          onClose={() => setOverlay("none")}
        />
      )}
      {recurrenceTarget && overlay === "custom" && (
        <CustomRecurrencePage
          initial={customInitial}
          onBack={() => setOverlay("preset")}
          onComplete={(recurrence, startDate) => {
            setOverlay("none");
            void run(() => updateTask(recurrenceTarget.id, { recurrence, startAt: normalizeScheduledDate(startDate) }));
          }}
        />
      )}
    </div>
  );
}
