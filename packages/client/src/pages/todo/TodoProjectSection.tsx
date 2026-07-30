import { useDroppable } from "@dnd-kit/core";
import { CaretDown, CaretRight, DotsThree, Plus, SignOut } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon.js";
import { contentTint } from "../../lib/contentTint.js";
import {
  isProjectMemberCountNearCap,
  RECENT_DONE_WINDOW_DAYS,
  type TodoProjectGroup,
} from "../../lib/tasks/goalMembership.js";
import { type ProjectChip, projectMemberState, sortProjectMembers, summarizeProjectGroup } from "../../lib/tasks/projectZone.js";
import { taskDueDateLabel } from "../../lib/tasks/taskTimeLabel.js";
import { TaskList } from "./TaskList.js";
import { META_CHIP_CLASS } from "./TaskRow.js";
import { projectContainerId } from "./todoDnd.js";

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
  onCreateTask: (goalId: string, title: string) => Promise<Task>;
  onRenameGoal: (goalId: string, title: string) => Promise<void>;
  onOpenGoal: (goalId: string) => void;
  /**
   * 当前拖拽的这条能不能落进项目组（null = 没在拖）。**判定由页面做，组件只渲染两态**。
   *
   * 组件判不了，理由三条（前两条从来就成立，第三条是子任务那支的根因）：
   * - 满员：组件手上只有可解析成员数（tasks + doneCount），而 500 闸看的是 goal.members
   *   数组长度（含 track 成员与悬空 ref），拿近似值画禁止态会撒谎。
   * - 目标组已归档 / 已改成 theme（`inactive`）：`TodoProjectGroup` 里根本没有 status/kind 字段，
   *   要判就得改投影层形状，代价远大于收益。
   * - 子任务：`listTasks` 把 `parentId !== null` 的行整个跳过，它不在任何 bucket 里，
   *   页面按 id 查得到 null、组件更无从谈起；只能从 dnd 容器 id 认，那是页面手上的东西。
   *
   * 满员与 inactive 仍只由写入侧 `assignTaskToProject` 抛错、走页面的 toast。因此存在一个**已知且刻意**的
   * 窗口：组在拖拽途中于另一端被归档时，组块仍显示「可落」高亮，松手才弹拒绝——**这不是 bug**。
   * 它换掉的是修复前那个「高亮 → 静默吞掉归属」的数据丢失，方向是净改善。
   */
  dropBlocked: boolean | null;
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

function displayProjectTasks(
  group: TodoProjectGroup,
  recentTaskIds: readonly string[],
  handSessionId: string | null,
  now: Date,
): Task[] {
  return recentTaskIds.length === 0 ? group.tasks : sortProjectMembers(group.tasks, { handSessionId, now, recentTaskIds });
}

/**
 * 单个项目组的组块：标题行 + 展开态内容区，整块就是那个 `project:<goalId>` 落点。
 *
 * 独立成组件是因为 `useDroppable` 是 hook，不能在 `groups.map` 的回调里调。
 *
 * **落点覆盖整块而非只有标题行**：展开后标题行只有一行高、下面是一整片任务列表，只认标题行会让
 * 展开态几乎瞄不准。组内不做用户自定义重排、组内行也不注册 sortable（`TaskList` 未传
 * `sortable`/`containerId` → `canSort=false` → 不渲染拖柄），因此整块当落点没有落点竞争。
 */
function ProjectGroupCard({
  group,
  expanded,
  dropBlocked,
  onToggleExpand,
  registerRef,
  onCreateTask,
  onTaskCreated,
  onRenameGoal,
  onOpenGoal,
  children,
}: {
  group: TodoProjectGroup;
  expanded: boolean;
  /** null = 没在拖，不画任何态 */
  dropBlocked: boolean | null;
  onToggleExpand: () => void;
  registerRef: (el: HTMLElement | null) => void;
  onCreateTask: (goalId: string, title: string) => Promise<Task>;
  onTaskCreated: (goalId: string, taskId: string) => void;
  onRenameGoal: (goalId: string, title: string) => Promise<void>;
  onOpenGoal: (goalId: string) => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(group.goalTitle);
  const createBusyRef = useRef(false);
  const renameBusyRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const containerId = projectContainerId(group.goalId);
  const { setNodeRef, isOver } = useDroppable({ id: containerId, data: { containerId } });
  const summary = summarizeProjectGroup(group);
  const showCapWarning = !summary.allDone && isProjectMemberCountNearCap(group.memberCount);
  const highlight =
    isOver && dropBlocked === false
      ? " ring-2 ring-inset ring-accent"
      : isOver && dropBlocked === true
        ? " opacity-60 ring-2 ring-inset ring-border-strong"
        : "";

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !menuTriggerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  function openCreate(): void {
    if (!expanded) onToggleExpand();
    setCreating(true);
    setCreateError(null);
  }

  async function submitCreate(): Promise<void> {
    const title = createDraft.trim();
    if (!title || createBusyRef.current) return;
    createBusyRef.current = true;
    try {
      const task = await onCreateTask(group.goalId, title);
      setCreateDraft("");
      setCreateError(null);
      onTaskCreated(group.goalId, task.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建任务失败");
    } finally {
      createBusyRef.current = false;
    }
  }

  // 失焦分流：空草稿收起；非空提交，成功收起、失败保留草稿+错误（满员等写入侧拒绝）。
  // createBusyRef 挡两类竞态：回车提交在途时触发的 blur、↵ 按钮路径。
  // 成功不调 onTaskCreated：置顶滚动是为回车连续录入服务的，失焦离场不需要。
  async function resolveBlur(): Promise<void> {
    if (createBusyRef.current) return;
    const title = createDraft.trim();
    if (!title) {
      setCreating(false);
      setCreateError(null);
      return;
    }
    createBusyRef.current = true;
    try {
      await onCreateTask(group.goalId, title);
      setCreateDraft("");
      setCreateError(null);
      setCreating(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建任务失败");
    } finally {
      createBusyRef.current = false;
    }
  }

  function openRename(): void {
    setMenuOpen(false);
    setRenameDraft(group.goalTitle);
    setRenaming(true);
  }

  async function submitRename(): Promise<void> {
    const title = renameDraft.trim();
    if (renameBusyRef.current) return;
    if (!title) {
      setRenaming(false);
      setRenameDraft(group.goalTitle);
      return;
    }
    renameBusyRef.current = true;
    try {
      await onRenameGoal(group.goalId, title);
      setRenaming(false);
    } catch {
      // 宿主负责 toast，输入框保留草稿便于修正后重试。
    } finally {
      renameBusyRef.current = false;
    }
  }

  return (
    <div
      data-testid="project-group"
      data-goal-id={group.goalId}
      data-droppable-id={containerId}
      {...(dropBlocked === null ? {} : { "data-drop-blocked": String(dropBlocked) })}
      ref={(el) => {
        // 两个 ref 各管一件事，都不能省：registerRef 供落点反馈滚动，setNodeRef 供 dnd-kit 量 rect。
        registerRef(el);
        setNodeRef(el);
      }}
      className={`rounded-card bg-surface transition${highlight}`}
    >
      <div className="relative flex items-center gap-1.5 px-2 py-1.5">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <input
              ref={renameInputRef}
              aria-label={`重命名项目 ${group.goalTitle}`}
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={() => {
                if (!renameBusyRef.current) {
                  setRenaming(false);
                  setRenameDraft(group.goalTitle);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                  setRenameDraft(group.goalTitle);
                  return;
                }
                if (event.key === "Enter") {
                  if (event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void submitRename();
                }
              }}
              className="min-w-0 flex-1 rounded-ctl bg-surface-elevated px-2 py-1 td-text-label text-ink outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            data-testid="project-group-toggle"
            aria-expanded={expanded}
            onClick={onToggleExpand}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-ctl py-1 text-left td-text-label font-medium text-ink-2 hover:bg-surface-hover"
          >
            <span className="shrink-0 text-ink-3">
              <Icon icon={expanded ? CaretDown : CaretRight} size={14} />
            </span>
            {/* 与组外 chip 同形同色的身份点，构成「点↔点」认同。组卡片不另加左侧色条：
                同一张卡片上两个颜色信号是同一件事的两种说法（同 chip / 竖条排他那条规则）。 */}
            <span
              aria-hidden="true"
              data-project-dot
              style={{ backgroundColor: contentTint(group.goalId) }}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
            />
            <span className="min-w-0 flex-1 truncate">{group.goalTitle}</span>
            <span className="shrink-0 td-text-caption font-normal text-ink-3">
              {summary.allDone
                ? `已完成 · ${summary.doneCount} 条`
                : summary.recentDoneCount > 0
                  ? `还剩 ${summary.remaining} · 近 ${RECENT_DONE_WINDOW_DAYS} 天 +${summary.recentDoneCount}`
                  : `还剩 ${summary.remaining}`}
            </span>
            {showCapWarning && <span className="shrink-0 td-text-caption font-normal text-warn">接近上限</span>}
          </button>
        )}
        {!summary.allDone && (
          <button
            type="button"
            aria-label={`在项目 ${group.goalTitle}中创建任务`}
            title="在项目中创建任务"
            onClick={(event) => {
              event.stopPropagation();
              openCreate();
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={Plus} size={16} />
          </button>
        )}
        <button
          ref={menuTriggerRef}
          type="button"
          aria-label={`项目 ${group.goalTitle} 更多操作`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="更多操作"
          onClick={(event) => {
            event.stopPropagation();
            if (menuOpen) {
              setMenuOpen(false);
              menuTriggerRef.current?.focus();
            } else {
              setMenuOpen(true);
            }
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-hover hover:text-ink"
        >
          <Icon icon={DotsThree} size={18} />
        </button>
        {menuOpen && (
          <div ref={menuRef} role="menu" aria-label={`项目 ${group.goalTitle} 更多操作`} className="absolute right-2 top-full z-20 min-w-36 overflow-hidden rounded-ctl border border-border bg-surface-elevated py-1 shadow-elev2">
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                openRename();
              }}
              className="block w-full px-3 py-2 text-left td-text-body text-ink hover:bg-surface-hover"
            >
              改名
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                menuTriggerRef.current?.focus();
                onOpenGoal(group.goalId);
              }}
              className="block w-full px-3 py-2 text-left td-text-body text-ink hover:bg-surface-hover"
            >
              在 goals 页打开
            </button>
          </div>
        )}
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
        <>
          {creating && (
            <div className="px-1.5 pb-1.5">
              {/* 幽灵任务行：复选框占位 + accent 描边表达「正在输入」，与任务行同形，提交后原地变真任务 */}
              <div
                data-testid="project-create-draft-row"
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1 ring-2 ring-inset ring-accent"
              >
                <span aria-hidden="true" data-slot="checkbox-placeholder" className="h-4 w-4 shrink-0 rounded border border-border" />
                <input
                  ref={createInputRef}
                  aria-label={`在项目 ${group.goalTitle}中新建任务`}
                  value={createDraft}
                  placeholder="新任务…"
                  onChange={(event) => setCreateDraft(event.target.value)}
                  onBlur={() => void resolveBlur()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCreating(false);
                      setCreateError(null);
                      return;
                    }
                    if (event.key !== "Enter") return;
                    if (event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    void submitCreate();
                  }}
                  className="min-w-0 flex-1 bg-transparent py-0.5 td-text-body text-ink outline-none placeholder:text-ink-3"
                />
                <button
                  type="button"
                  aria-label="提交新任务"
                  title="提交（回车）"
                  // pointerdown 阻断失焦：避免「点按钮先触发 blur 提交、click 再提交一次」
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void submitCreate()}
                  className="flex h-6 w-7 shrink-0 items-center justify-center rounded-ctl bg-accent text-white"
                >
                  ↵
                </button>
              </div>
              {createError && <p className="mt-1 td-text-caption text-danger">{createError}</p>}
            </div>
          )}
          {/* 组内容区退回页面底色：行自带 bg-surface，与卡片同色时行缝隐形、子项糊成一块（其他区域的行铺在 bg-page 上才有分割感）。 */}
          <div className="todo-project-group-body mx-1.5 mb-1.5 overflow-y-auto rounded-ctl bg-page p-1.5">{children}</div>
        </>
      )}
    </div>
  );
}

export function TodoProjectSection({
  groups,
  handSessionId,
  now,
  revealGoals,
  onRevealConsumed,
  onExitProject,
  onCreateTask,
  onRenameGoal,
  onOpenGoal,
  dropBlocked,
  ...rowHandlers
}: TodoProjectSectionProps) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [recentTaskIds, setRecentTaskIds] = useState<Map<string, readonly string[]>>(() => new Map());
  const rowRefs = useRef(new Map<string, HTMLElement | null>());

  // 默认全折叠。组展开只由用户点击或落点反馈（revealGoals）驱动，没有「首次全展开」那一档——
  // 那一档原本挂在排他上线的一次性说明条上，说明条 2026-07-27 撤掉后一并退役。
  const isExpanded = (goalId: string): boolean => overrides.get(goalId) ?? false;

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
          const visibleTasks = displayProjectTasks(group, recentTaskIds.get(group.goalId) ?? [], handSessionId, now);
          return (
            <ProjectGroupCard
              key={group.goalId}
              group={group}
              expanded={isExpanded(group.goalId)}
              dropBlocked={dropBlocked}
              onToggleExpand={() => setOverrides((prev) => new Map(prev).set(group.goalId, !isExpanded(group.goalId)))}
              onCreateTask={onCreateTask}
              onTaskCreated={(goalId, taskId) => {
                setRecentTaskIds((prev) => {
                  const next = new Map(prev);
                  next.set(goalId, [taskId, ...(prev.get(goalId) ?? []).filter((id) => id !== taskId)]);
                  return next;
                });
              }}
              onRenameGoal={onRenameGoal}
              onOpenGoal={onOpenGoal}
              registerRef={(el) => {
                rowRefs.current.set(group.goalId, el);
              }}
            >
              {visibleTasks.length > 0 && (
                <TaskList
                  pool="inbox"
                  tasks={visibleTasks}
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
            </ProjectGroupCard>
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
      {/* 圆点是项目的专属形状、色按 goalId 派生（标签那边归 `#`，见 ADR 0026）。
          不再用 bg-ok：绿是「已完成 / theme 归属」的状态语义，不归项目身份占用。 */}
      <span
        aria-hidden="true"
        data-project-dot
        style={{ backgroundColor: contentTint(chip.goalId) }}
        className="h-1.5 w-1.5 shrink-0 rounded-full"
      />
      {chip.goalTitle}
    </button>
  );
}

