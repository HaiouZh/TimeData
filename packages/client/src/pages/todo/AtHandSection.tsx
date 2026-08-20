import { HandGrabbing, X } from "@phosphor-icons/react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Session, Task } from "@timedata/shared";
import { useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon.js";
import type { ResumableSession } from "../../lib/sessions.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { SortableTaskRow } from "./SortableTaskRow.js";
import { TaskRow } from "./TaskRow.js";

export interface AtHandSectionProps {
  atHand: Task[];
  session: Session | null;
  resumable: ResumableSession[];
  onRelease: (t: Task) => void;
  onEndSession: () => void;
  onResume: (sessionId: string) => void;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  /** 标题 Shift+单击复制成功后的上抛回调（透传 TaskRow；宿主反馈 toast）。 */
  onCopyTitle?: (t: Task) => void;
  goalLinkedIds?: ReadonlySet<string>;
  /** meta 胶囊带插槽：手头区用它显示项目名 chip。 */
  metaChip?: (task: Task) => ReactNode;
  /** 场便签保存：空串已归一为 null;不传则标题不可编辑。 */
  onUpdateNote?: (note: string | null) => void;
  /** 标题计数值（含子任务的未完总数）。不传则回落为未完根任务数。 */
  pendingTotal?: number;
  /** 缩进候选父：命中该 id 的行渲染高亮环。 */
  indentTargetId?: string | null;
  /** 收纳后要展开的父行 id（透传 TaskRow，落点反馈）。只作用于未完成区。 */
  revealChildren?: { id: string; nonce: number } | null;
  handTracks?: ReactNode;
}

function sessionDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function AtHandRowsSurface({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card p-1.5">
      <div className="min-w-0 space-y-1 overflow-x-clip">{children}</div>
    </div>
  );
}

function AtHandHeading({
  count,
  action,
  note,
  onSaveNote,
}: {
  count: number;
  action?: ReactNode;
  note?: string | null;
  onSaveNote?: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // 空串 note 可能从同步对端/历史数据进来（schema 不禁），空白一律回落默认标题。
  const title = note?.trim() ? note : "手头";
  // 脏检查：值没变（含仅空白差异）只退出编辑不写库——否则误触标题再失焦就是一次
  // 零意图的 LWW 写入，跨设备会用陈旧内容覆盖对端刚改的便签。
  function saveAndExit(value: string) {
    setEditing(false);
    if (value.trim() === (note?.trim() ?? "")) return;
    onSaveNote?.(value);
  }
  return (
    <div className="mb-2 flex items-center justify-between px-2">
      <h2 className="flex min-w-0 items-center gap-1.5 td-text-label font-medium text-ink">
        <span className="shrink-0 text-ink-3">
          <Icon icon={HandGrabbing} size={16} />
        </span>
        {editing && onSaveNote ? (
          <input
            aria-label="场便签"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- 用户主动点击进入编辑，聚焦是预期
            autoFocus
            maxLength={200}
            defaultValue={note ?? ""}
            className="min-w-0 flex-1 rounded-ctl bg-surface px-1 font-medium text-ink outline-none"
            onKeyDown={(event) => {
              // IME 组合态的 Enter 是在确认候选词，不是保存指令。
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                // 保存并退出；退出后 input 卸载，onBlur 不再触发，保证单次保存。
                saveAndExit(event.currentTarget.value);
              } else if (event.key === "Escape") {
                setEditing(false);
              }
            }}
            onBlur={(event) => saveAndExit(event.currentTarget.value)}
          />
        ) : onSaveNote ? (
          <button
            type="button"
            aria-label="编辑场便签"
            className="min-w-0 truncate text-left"
            onClick={() => setEditing(true)}
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 truncate">{title}</span>
        )}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <span className="td-text-caption text-ink-3">{count}</span>
        {action}
      </div>
    </div>
  );
}

export function AtHandSection({
  atHand,
  session,
  resumable,
  onRelease,
  onEndSession,
  onResume,
  onToggle,
  onEdit,
  onCopyTitle,
  goalLinkedIds,
  metaChip,
  onUpdateNote,
  pendingTotal,
  indentTargetId,
  revealChildren,
  handTracks,
}: AtHandSectionProps) {
  if (session === null && resumable.length === 0) return null;

  if (session === null) {
    return (
      <section data-section="todo-at-hand">
        <AtHandHeading count={resumable.length} />
        <AtHandRowsSurface>
          {resumable.map(({ session: s, pendingCount, pendingTitles }) => (
            <div key={s.id} className="flex items-center gap-2 rounded-row bg-surface px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate td-text-label text-ink-2">
                  {pendingTitles.join("、")}
                  {pendingCount > pendingTitles.length ? " …" : ""}
                </p>
                <p className="td-text-caption text-ink-3">
                  {sessionDateLabel(s.startedAt)} · 还有 {pendingCount} 条未完
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-accent hover:bg-surface-elevated"
                onClick={() => onResume(s.id)}
              >
                续场
              </button>
            </div>
          ))}
        </AtHandRowsSurface>
      </section>
    );
  }

  const pending = atHand.filter((t) => !t.done);
  const doneCount = atHand.length - pending.length;
  const releaseAction = (task: Task) => (
    <button
      type="button"
      aria-label={`移出手头 ${task.title}`}
      onClick={(event) => {
        event.stopPropagation();
        onRelease(task);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-ink"
    >
      <Icon icon={X} size={16} />
    </button>
  );

  return (
    <section data-section="todo-at-hand">
      <AtHandHeading
        // 换场强制重挂：清掉编辑态与非受控 input 残值，防止把旧场预填文本保存进新活跃场。
        key={session.id}
        count={pendingTotal ?? pending.length}
        note={session.note}
        onSaveNote={onUpdateNote ? (value) => onUpdateNote(value.trim() === "" ? null : value) : undefined}
        action={
          <button
            type="button"
            className="rounded-ctl px-2 py-1 td-text-label text-ink-3 hover:bg-surface-elevated hover:text-ink"
            onClick={onEndSession}
          >
            散场
          </button>
        }
      />
      {handTracks}
      {pending.length === 0 && !handTracks ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center td-text-label text-ink-3">手头空了，抓点活或散场</p>
      ) : pending.length > 0 ? (
        <AtHandRowsSurface>
          <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {pending.map((task) => (
              // 同 TaskList：缩进态下冻结避让，只留高亮环（见 SortableTaskRow.freezeShift 注释）。
              <SortableTaskRow key={task.id} id={task.id} containerId="hand" freezeShift={indentTargetId != null}>
                {(handle) => (
                  <TaskRow
                    task={task}
                    pool="inbox"
                    childrenModeOverride="draggable"
                    indentTargetActive={indentTargetId === task.id}
                    revealChildren={revealChildren}
                    dragHandle={handle}
                    extraAction={releaseAction}
                    onToggle={onToggle}
                    onEdit={onEdit}
                    onCopyTitle={onCopyTitle}
                    inGoal={goalLinkedIds?.has(task.id)}
                    metaChip={metaChip?.(task)}
                  />
                )}
              </SortableTaskRow>
            ))}
          </SortableContext>
        </AtHandRowsSurface>
      ) : null}
      {doneCount > 0 && (
        <div className="mt-2">
          <CollapsibleSection title="本场已完成" count={doneCount} defaultOpen={false}>
            <AtHandRowsSurface>
              {atHand
                .filter((t) => t.done)
                .map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    pool="completed"
                    // 父行完成不代理子任务：库里它们仍是 done:false，没有这条 override 会落到
                    // pool==="completed" 的默认 readonly（见 TaskRow childModeForPool），
                    // 那些子任务会永久拿不到勾选框/编辑入口。static 允许勾选/编辑/删除但不参与拖拽。
                    childrenModeOverride="static"
                    onToggle={onToggle}
                    onEdit={onEdit}
                    onCopyTitle={onCopyTitle}
                  />
                ))}
            </AtHandRowsSurface>
          </CollapsibleSection>
        </div>
      )}
    </section>
  );
}
