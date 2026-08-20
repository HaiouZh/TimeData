import type { Task } from "@timedata/shared";
import { useIsCoarsePointer } from "../../lib/useIsCoarsePointer.js";
import { META_CHIP_CLASS, TaskRow } from "./TaskRow.js";

/**
 * 「在等」区：停滞轨道 + 被未完成前置挡住的任务。
 *
 * 任务准入由 `listTasks` 的 waiting 桶保证——与「已归 active project 的根任务不进收件箱」
 * 同一层的排他分流：被挡任务不再进 today/inbox/scheduled，只落这里，因此同一条任务不会两处出现。
 * 阶段2 曾拍板「不收任务」（怕排期过期/重力沉降的任务两处双显、两套口径各调各的），
 * 该担心已由分流消解，本区自 waiting 桶落地起收任务行。
 *
 * 本区**不套折叠组**（今天区的轨道才套）：整区即轨道，再套一层折叠是多余嵌套。
 * 空区整块不渲染——没有停滞轨道也没有被挡任务时不留一个空标题在那儿。
 */
export interface WaitingSectionProps {
  /** 被挡任务行（listTasks 的 waiting 桶）。 */
  tasks?: Task[];
  /** taskId → 挡着它的那些东西的标题，只含 `tasks` 里的任务。 */
  blockerTitles?: Record<string, string[]>;
  onToggle?: (t: Task) => void;
  onEdit?: (t: Task) => void;
  onDelete?: (t: Task) => void;
  onToToday?: (t: Task) => void;
  onToInbox?: (t: Task) => void;
  onToHand?: (t: Task) => void;
  goalLinkedIds?: ReadonlySet<string>;
  onCopyTitle?: (t: Task) => void;
}

const noop = (): void => {};

function blockerLabel(titles: readonly string[]): string {
  if (titles.length === 0) return "";
  // 多个 blocker 逗号连接（标题短，全列出来比「等 N 项」直白）。
  return `等 ${titles.join("、")}`;
}

export function WaitingSection({
  tasks = [],
  blockerTitles = {},
  onToggle = noop,
  onEdit = noop,
  onDelete,
  onToToday,
  onToInbox,
  onToHand,
  goalLinkedIds,
  onCopyTitle,
}: WaitingSectionProps) {
  const coarsePointer = useIsCoarsePointer();
  if (tasks.length === 0) return null;
  return (
    <section data-testid="todo-section-waiting" data-section="waiting">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className="td-text-label font-medium text-ink">在等</h2>
        <span className="td-text-caption text-ink-3">{tasks.length}</span>
      </div>
      <div className="rounded-card p-1.5">
        {tasks.map((task) => {
          const label = blockerLabel(blockerTitles[task.id] ?? []);
          return (
            <div key={task.id} className="mb-1 last:mb-0">
              <TaskRow
                task={task}
                pool="inbox"
                coarsePointer={coarsePointer}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
                onToToday={onToToday}
                onToInbox={onToInbox}
                onToHand={onToHand}
                onCopyTitle={onCopyTitle}
                inGoal={goalLinkedIds?.has(task.id) ?? false}
                metaChip={
                  label.length > 0 ? (
                    <span data-testid="waiting-blocker-chip" className={`${META_CHIP_CLASS} text-ink-2`}>
                      {label}
                    </span>
                  ) : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
