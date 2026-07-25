import { CaretDown, CaretRight, SignOut, X } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { type ProjectChip, projectMemberState, summarizeProjectGroup } from "../../lib/tasks/projectZone.js";
import { getProjectZoneIntroDismissed, setProjectZoneIntroDismissed } from "../../lib/tasks/workbenchPrefs.js";
import { formatYearAwareMonthDay, getDateString } from "../../lib/time.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskList } from "./TaskList.js";
import { META_CHIP_CLASS } from "./TaskRow.js";

export interface TodoProjectSectionProps {
  /** 已按组间排序好的项目区分组，**不过标签筛选**（与手头区一致，见 design §非目标）。 */
  groups: TodoProjectGroup[];
  handSessionId: string | null;
  now: Date;
  /** 外部（项目名 chip）要求展开并滚到的组；nonce 变化即重新触发，同 TaskRow 的 revealChildren 形态。 */
  revealGoal?: { id: string; nonce: number } | null;
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
  const label =
    state.kind === "at-hand"
      ? "在手头"
      : state.kind === "today"
        ? "今天"
        : formatYearAwareMonthDay(getDateString(new Date(state.scheduledAt)));
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
  revealGoal,
  onExitProject,
  ...rowHandlers
}: TodoProjectSectionProps) {
  // 首次（存量提示条尚未关闭）默认展开全部组，之后默认全折叠。
  // 读一次存进 state：用户后来关掉提示条时，不该把已经展开的组收回去。
  const [introPending] = useState(() => !getProjectZoneIntroDismissed());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const rowRefs = useRef(new Map<string, HTMLElement | null>());

  const isExpanded = (goalId: string): boolean => overrides.get(goalId) ?? introPending;

  useEffect(() => {
    if (!revealGoal) return;
    const goalId = revealGoal.id;
    setOverrides((prev) => new Map(prev).set(goalId, true));
    // jsdom 的 Element 上没有 scrollIntoView，两级可选调用兜住（测试环境不能因此抛）。
    rowRefs.current.get(goalId)?.scrollIntoView?.({ block: "nearest" });
  }, [revealGoal]);

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
