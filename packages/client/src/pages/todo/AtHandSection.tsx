import { HandGrabbing, X } from "@phosphor-icons/react";
import type { Session, Task } from "@timedata/shared";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";
import type { ResumableSession } from "../../lib/sessions.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
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
  goalLinkedIds?: ReadonlySet<string>;
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

function AtHandHeading({ count, action }: { count: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-2">
      <h2 className="flex items-center gap-1.5 td-text-label font-medium text-ink">
        <span className="text-ink-3">
          <Icon icon={HandGrabbing} size={16} />
        </span>
        <span>手头</span>
      </h2>
      <div className="flex items-center gap-2">
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
  goalLinkedIds,
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
        count={pending.length}
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
      {pending.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center td-text-label text-ink-3">手头空了，抓点活或散场</p>
      ) : (
        <AtHandRowsSurface>
          {pending.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pool="inbox"
              childrenModeOverride="static"
              extraAction={releaseAction}
              onToggle={onToggle}
              onEdit={onEdit}
              inGoal={goalLinkedIds?.has(task.id)}
            />
          ))}
        </AtHandRowsSurface>
      )}
      {doneCount > 0 && (
        <div className="mt-2">
          <CollapsibleSection title="本场已完成" count={doneCount} defaultOpen={false}>
            <AtHandRowsSurface>
              {atHand
                .filter((t) => t.done)
                .map((task) => (
                  <TaskRow key={task.id} task={task} pool="completed" onToggle={onToggle} onEdit={onEdit} />
                ))}
            </AtHandRowsSurface>
          </CollapsibleSection>
        </div>
      )}
    </section>
  );
}
