import { CaretDown, CaretRight, SignOut, X } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { type ProjectChip, projectMemberState, summarizeProjectGroup } from "../../lib/tasks/projectZone.js";
import { taskDueDateLabel } from "../../lib/tasks/taskTimeLabel.js";
import { getProjectZoneIntroDismissed, setProjectZoneIntroDismissed } from "../../lib/tasks/workbenchPrefs.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskList } from "./TaskList.js";
import { META_CHIP_CLASS } from "./TaskRow.js";

export interface TodoProjectSectionProps {
  /** 已按组间排序好的项目区分组，**不过标签筛选**（与手头区一致，见 design §非目标）。 */
  groups: TodoProjectGroup[];
  handSessionId: string | null;
  now: Date;
  /**
   * 外部要求展开并滚过去的组（项目名 chip 回跳 / 落点反馈），是**待消费意图不是脉冲**：
   * 目标组这一帧可能还没渲染出来（成员刚升根 / 刚清掉重复，要等 listTasks 整轮重算才产出这组），
   * 那时 ref 上没有节点，滚动会静默丢失。故留在数组里等组出现再消费。
   */
  revealGoals: readonly string[];
  /**
   * 已消费（组已展开、已尝试滚动）的 goalId 回报给宿主清空。**必填**：不清空的话，
   * 跨 1024px 断点时本组件整棵重挂（projectsBlock 换了父容器），mount effect 会把上一次的意图重放一遍——
   * 用户手动折叠的状态丢失、页面被滚走。
   */
  onRevealConsumed: (goalIds: string[]) => void;
  onExitProject: (goalId: string, task: Task) => void;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToToday: (task: Task) => void;
  onToInbox: (task: Task) => void;
  onToHand?: (task: Task) => void;
}

/** 成员的「当前在哪」胶囊。`idle`（躺着）是默认多数态，不画胶囊——没有胶囊本身就是答案。 */
function memberStateChip(task: Task, handSessionId: string | null, now: Date): ReactNode {
  const state = projectMemberState(task, { handSessionId, now });
  if (state.kind === "idle") return null;
  // 排期日文案走 taskDueDateLabel（任务行日期胶囊的同一个内核），不在这里再写一遍日期格式化：
  // 项目区成员恒为非重复（归集守卫 `recurrence === null && ruleId === null`），它必走「排期日」分支，
  // 与 `state.scheduledAt` 同源、恒非 null——下面的 null 判只是给类型收口。
  const label = state.kind === "at-hand" ? "在手头" : state.kind === "today" ? "今天" : taskDueDateLabel(task);
  if (label === null) return null;
  return (
    <span data-testid="project-member-state" className={`${META_CHIP_CLASS} text-ink-2`}>
      {label}
    </span>
  );
}

export function TodoProjectSection({
  groups,
  handSessionId,
  now,
  revealGoals,
  onRevealConsumed,
  onExitProject,
  ...rowHandlers
}: TodoProjectSectionProps) {
  // 首次（存量提示条尚未关闭）默认展开全部组，之后默认全折叠。
  // 读一次存进 state：用户后来关掉提示条时，不该把已经展开的组收回去。
  const [introPending] = useState(() => !getProjectZoneIntroDismissed());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const rowRefs = useRef(new Map<string, HTMLElement | null>());

  const isExpanded = (goalId: string): boolean => overrides.get(goalId) ?? introPending;

  // 消费展开意图：只认**这一帧真的渲染出来了**的组（渲染出来 ⇒ ref 回调已跑完，节点必在 rowRefs 里）。
  // 没渲染出来的留着不消费，groups 变化时本 effect 重跑、届时补上——这正是「滚动那一半永久丢失」的修法。
  useEffect(() => {
    if (revealGoals.length === 0) return;
    const rendered = new Set(groups.map((group) => group.goalId));
    const consumed = revealGoals.filter((goalId) => rendered.has(goalId));
    const first = consumed[0];
    if (first === undefined) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const goalId of consumed) next.set(goalId, true);
      return next;
    });
    // 只滚到第一个：同时展开多组时连着滚会互相打架。
    // 两级可选调用兜的是两件不同的事，都不能删：`?.` 兜 ref 尚未挂上，`scrollIntoView?.` 兜 jsdom 的
    // Element 根本没有这个方法（测试环境不能因此抛）。
    rowRefs.current.get(first)?.scrollIntoView?.({ block: "nearest" });
    onRevealConsumed(consumed);
  }, [revealGoals, groups, onRevealConsumed]);

  if (groups.length === 0) return null;

  return (
    <section data-section="todo-projects">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className="td-text-label font-medium text-ink">项目</h2>
        <span className="td-text-caption text-ink-3">{groups.length}</span>
      </div>
      <div className="space-y-1">
        {groups.map((group) => {
          const summary = summarizeProjectGroup(group);
          const expanded = isExpanded(group.goalId);
          return (
            <div
              key={group.goalId}
              data-testid="project-group"
              data-goal-id={group.goalId}
              ref={(el) => {
                rowRefs.current.set(group.goalId, el);
              }}
              className="rounded-card bg-surface"
            >
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button
                  type="button"
                  data-testid="project-group-toggle"
                  aria-expanded={expanded}
                  onClick={() => setOverrides((prev) => new Map(prev).set(group.goalId, !expanded))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-ctl py-1 text-left td-text-label font-medium text-ink-2 hover:bg-surface-hover"
                >
                  <span className="shrink-0 text-ink-3">
                    <Icon icon={expanded ? CaretDown : CaretRight} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{group.goalTitle}</span>
                  <span className="shrink-0 td-text-caption font-normal text-ink-3">
                    {summary.allDone
                      ? `已完成 · ${summary.total} 条`
                      : `还剩 ${summary.remaining} / 共 ${summary.total}`}
                  </span>
                </button>
                {summary.allDone && (
                  <Link
                    to={`/goals/${group.goalId}`}
                    className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-accent hover:bg-surface-elevated"
                  >
                    去归档
                  </Link>
                )}
              </div>
              {expanded && (
                <div className="px-1.5 pb-1.5">
                  {group.tasks.length > 0 && (
                    <TaskList
                      pool="inbox"
                      tasks={group.tasks}
                      childrenModeOverride="static"
                      metaChip={(task) => memberStateChip(task, handSessionId, now)}
                      extraAction={(task) => (
                        <button
                          type="button"
                          aria-label={`退出项目 ${task.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onExitProject(group.goalId, task);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-ink"
                        >
                          <Icon icon={SignOut} size={16} />
                        </button>
                      )}
                      {...rowHandlers}
                    />
                  )}
                  {group.doneTasks.length > 0 && (
                    <div className="mt-1">
                      <CollapsibleSection title="已完成" count={group.doneTasks.length} defaultOpen={false}>
                        <TaskList pool="completed" tasks={group.doneTasks} {...rowHandlers} />
                      </CollapsibleSection>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 组外行（手头 / 今天 / 已排期）的项目名 chip：既是「这条属于哪个项目」的标注，
 * 也是回跳入口——点它展开项目区里的对应组。
 *
 * `relative z-20` 是必须的：任务行左 2/5 盖着一个 `z-10` 的拖拽 activator 按钮，
 * 不抬层级的话点击会被它吃掉。`stopPropagation` 则拦住行的 onClick（打开详情）。
 */
export function ProjectNameChip({ chip, onOpen }: { chip: ProjectChip; onOpen: (goalId: string) => void }) {
  return (
    <button
      type="button"
      data-testid="project-name-chip"
      aria-label={`查看项目 ${chip.goalTitle}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(chip.goalId);
      }}
      className={`relative z-20 ${META_CHIP_CLASS} text-ink-2 hover:text-ink`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
      {chip.goalTitle}
    </button>
  );
}

/**
 * 排他上线后的一次性说明条：挂在收件箱顶部（任务是从那里消失的），不是项目区顶部。
 * 关闭位同时决定项目区「首次默认展开」，两者共用一个偏好。
 */
export function ProjectZoneIntroBar({ memberCount, groupCount }: { memberCount: number; groupCount: number }) {
  const [dismissed, setDismissed] = useState(() => getProjectZoneIntroDismissed());
  if (dismissed || memberCount === 0) return null;
  return (
    <div
      data-testid="project-zone-intro"
      className="mb-2 flex items-start gap-2 rounded-card bg-surface px-3 py-2 td-text-caption text-ink-2"
    >
      <p className="min-w-0 flex-1">
        {memberCount} 条任务已归入 {groupCount} 个项目，移到上方项目区。
      </p>
      <button
        type="button"
        aria-label="知道了"
        onClick={() => {
          setDismissed(true);
          setProjectZoneIntroDismissed(true);
        }}
        className="shrink-0 rounded-ctl text-ink-3 hover:text-ink"
      >
        <Icon icon={X} size={14} />
      </button>
    </div>
  );
}
