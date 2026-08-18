import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { formatAppDateTime, formatRelativeTime } from "../../lib/time.js";
import { appendUserStep } from "../../lib/tracks.js";

/** 展开后行内显示几步。看全貌走「共 N 步 →」跳轨道页——跑了两个月的轨道全铺就是几屏。 */
const INLINE_STEP_LIMIT = 3;

export interface TrackRowProps {
  row: TodoTrackRow;
  /**
   * 展开态**由页面持有**，不由本行持有。理由：写一步会让停滞轨道的 lastActivityAt 刷新、
   * bucketForTrack 从 waiting 变 doing，行当场从「在等」区跳到「今天」区——两个不同父容器，
   * React 必然卸载重挂，行内本地 state 必丢（刚展开的步骤流会收起、刚打开的输入行会消失）。
   */
  expanded: boolean;
  onToggleExpand: () => void;
  /** 页面单一时钟（TodoPage 的 gravityNow），相对时间不各算各的。 */
  now: Date;
}

/**
 * todo 页的轨道行。与任务行同区并排，靠**形状**区分类型（三道刻度 = 轨道，方框 = 任务）。
 *
 * 点击分区与任务行统一（`taskRowZone`）：左 2/5 展开步骤流，右 3/5 跳轨道页。
 * 轨道没有详情抽屉，它的「详情」就是 `/tracks/:id`，语义与任务行的右 3/5 对齐。
 *
 * 键盘上 Enter = 跳轨道页，展开只能靠鼠标分区——**与 `TaskRow` 同款界限**，不在本阶段新开 a11y 模式。
 *
 * 不注册 sortable / droppable，且**永远渲染在 `SortableContext` 之外**：
 * `verticalListSortingStrategy` 按 DOM 顺序算位置，夹进任务行之间会扰乱计算。
 */
export function TrackRow({ row, expanded, onToggleExpand, now }: TrackRowProps) {
  const navigate = useNavigate();
  const href = `/tracks/${encodeURIComponent(row.track.id)}`;
  // 倒序取最近几步。开口步 seq 最大，天然落在这几条里，不必单独置顶。
  const recentSteps = [...row.steps].sort((a, b) => b.seq - a.seq).slice(0, INLINE_STEP_LIMIT);

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // 挂载即聚焦：与 InlineChildren 的草稿行同款——紧随用户手势的程序化聚焦在 APK(WebView) 上会唤起软键盘。
  useEffect(() => {
    if (drafting) draftRef.current?.focus();
  }, [drafting]);

  // 展开态被收起时草稿一并丢弃，避免下次展开还挂着上一次的半截输入。
  useEffect(() => {
    if (!expanded) {
      setDrafting(false);
      setDraftError(null);
    }
  }, [expanded]);

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width) === "expand") {
      onToggleExpand();
      return;
    }
    void navigate(href);
  }

  /**
   * 与轨道页 `StepComposer` 同一条契约（TK-01）：**写入成功后才清空草稿；失败保留原文并 inline 报错。**
   *
   * 反过来（先同步清空、再 fire-and-forget）会让写失败时用户刚打的字无处可寻——而
   * `appendUserStep` 确实会抛（轨道被另一端并发删除、Dexie 事务失败），且全仓没有
   * `unhandledrejection` 兜底、React error boundary 不拦 promise，症状是「界面零反馈、字没了」。
   *
   * `submittingRef` 挡在途窗口的第二次提交：以前靠「先清空 value」顺带挡住，现在不清了得显式挡。
   */
  async function resolveDraft(source: "enter" | "blur"): Promise<void> {
    const content = (draftRef.current?.value ?? "").trim();
    if (!content) {
      setDraftError(null);
      setDrafting(false);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      // 只记即时步：开口步表达「我正在做这个」，待办页已经有「手头」在说这件事，两套说法重叠；
      // 且开口步会自动闭掉上一条开口步，那个副作用在行内看不见。开口步留在轨道页的 StepComposer。
      await appendUserStep({ trackId: row.track.id, content, mode: "instant", tags: [] });
      if (draftRef.current) draftRef.current.value = "";
      setDraftError(null);
      // 非空回车保持草稿继续录入（同 InlineChildren）；失焦提交完就收起。
      if (source === "blur") setDrafting(false);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "写入失败，请重试");
    } finally {
      submittingRef.current = false;
    }
  }

  function handleDraftKey(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    // IME 双闸与 TaskDetailSheet 对齐：`isComposing` 在部分 Android 输入法上不置位，`keyCode === 229`
    // 是那一档的兜底。少一道就会在组词途中按回车提交半截拼音。
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    ) {
      event.preventDefault();
      void resolveDraft("enter");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftError(null);
      setDrafting(false);
    }
  }

  return (
    <div className="w-full rounded-row transition-colors duration-150 hover:bg-surface-hover">
      <div
        data-testid="todo-track-row"
        role="link"
        tabIndex={0}
        aria-label={`查看轨道 ${row.track.title}`}
        aria-expanded={expanded}
        onClick={handleRowClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter") return;
          event.preventDefault();
          void navigate(href);
        }}
        // 焦点环要显式写：从 <a href> 改成 role="link" 的 div 之后，浏览器不再给默认焦点样式，
        // 而 index.css 也没有 :focus-visible 兜底——不补的话键盘用户 Tab 过来看不见自己停在哪一行。
        className="flex items-start gap-2.5 rounded-row px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span aria-hidden className="mt-1 flex shrink-0 flex-col items-center gap-0.5">
          <span className="block h-px w-3 bg-ink-3" />
          <span className="block h-px w-2 bg-ink-3" />
          <span className="block h-px w-2.5 bg-ink-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block td-text-body text-ink">{row.track.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 td-text-caption text-ink-3">
            <span className="td-num">{row.stepCount} 步</span>
            {row.hasOpenStep && <span className="text-accent-ink">进行中</span>}
          </span>
        </span>
      </div>

      {expanded && (
        <div className="ml-9 space-y-1 pb-2 pr-2">
          {recentSteps.map((step) => {
            const activityAt = step.endedAt ?? step.startedAt;
            return (
              <div
                key={step.id}
                data-testid="todo-track-step"
                className="flex items-start gap-2 rounded-row bg-surface-elevated px-2 py-1"
              >
                <span className="min-w-0 flex-1 td-text-body text-ink-2">{step.content}</span>
                {step.endedAt === null && <span className="shrink-0 td-text-caption text-accent-ink">进行中</span>}
                <span className="shrink-0 td-text-caption text-ink-3" title={formatAppDateTime(activityAt)}>
                  {formatRelativeTime(activityAt, now)}
                </span>
              </div>
            );
          })}
          {drafting ? (
            <div data-testid="track-step-draft-row">
              <div className="flex items-start gap-2 rounded-row px-2 py-1 ring-2 ring-inset ring-accent">
                <textarea
                  ref={draftRef}
                  aria-label="新步骤内容"
                  rows={2}
                  placeholder=""
                  onKeyDown={handleDraftKey}
                  onBlur={() => void resolveDraft("blur")}
                  // 不写字号类：index.css 把 input/textarea/select 兜底到 16px 消除 iOS 聚焦缩放，
                  // td-text-* 三档都小于 16px 且类选择器优先级更高，写上去会把兜底顶掉。
                  className="min-h-8 min-w-0 flex-1 resize-none break-words bg-transparent text-ink outline-none"
                />
              </div>
              {draftError !== null && (
                <p data-testid="track-step-draft-error" role="alert" className="px-2 pt-1 td-text-caption text-danger">
                  {draftError}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              aria-label="记一步"
              onClick={() => setDrafting(true)}
              className="min-h-8 select-none td-text-caption text-ink-3 hover:text-ink-2"
            >
              + 记一步
            </button>
          )}
          {row.stepCount > 0 && (
            <button
              type="button"
              aria-label={`查看轨道 ${row.track.title}的全部步骤`}
              onClick={() => void navigate(href)}
              className="min-h-8 select-none td-text-caption text-ink-3 hover:text-accent"
            >
              共 {row.stepCount} 步 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
