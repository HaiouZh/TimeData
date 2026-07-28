import { useDroppable } from "@dnd-kit/core";
import { todoDockId, todoDockTargets, type TodoDockTarget } from "./todoDnd.js";

export interface TodoDockProject {
  goalId: string;
  goalTitle: string;
}

export interface TodoDragDockProps {
  /** 拖拽进行中才显形;false 时保持挂载(droppable rect 在拖起瞬间已就绪)但透明。 */
  dragging: boolean;
  /** 被拖行的 dnd 容器 id,决定隐藏哪个池药丸;null = 未在拖拽。 */
  activeContainerId: string | null;
  projects: readonly TodoDockProject[];
  /** 拖拽中的行不允许入项目时,项目药丸置禁用视觉(与项目卡 data-drop-blocked 同源判定)。 */
  dropBlocked: boolean | null;
}

function dockTargetLabel(target: TodoDockTarget, projects: readonly TodoDockProject[]): string {
  if (target.kind === "pool") return target.pool === "today" ? "今天" : "收件箱";
  if (target.kind === "hand") return "手头";
  return projects.find((p) => p.goalId === target.goalId)?.goalTitle ?? "项目";
}

function DockPill({ target, label, blocked }: { target: TodoDockTarget; label: string; blocked: boolean }) {
  const id = todoDockId(target);
  const { setNodeRef, isOver } = useDroppable({ id, data: { containerId: id } });
  return (
    <li
      ref={setNodeRef}
      data-testid="todo-dock-pill"
      data-dock-id={id}
      data-drop-blocked={blocked}
      className={`max-w-56 truncate rounded-pill border px-3 py-1 td-text-caption transition ${
        blocked
          ? "border-border bg-surface text-ink-3 opacity-60"
          : isOver
            ? "scale-105 border-accent bg-accent-soft text-accent"
            : "border-border bg-surface-elevated text-ink-2"
      }`}
    >
      {label}
    </li>
  );
}

/**
 * 拖拽投递坞:拖起任务时视口右缘淡入的一列瞬态落点药丸(design spec 2026-07-28-todo-drag-dock)。
 * - 常驻挂载、只切透明度:避开 dnd-kit 拖拽中挂载 droppable 的测量时序。
 * - pointer-events 只在拖拽中放开:dnd-kit 命中走指针坐标不吃 DOM 事件,但坞内滚动要接滚轮——
 *   恒 none 时滚轮穿透到页面,超出一屏的项目药丸在拖拽中永远够不到;平时 none,不拦点击。
 * - 淡入 300ms 延迟(CSS delay,不用计时器):列表内短距重排不会闪出坞;隐藏 duration 0 = 松手即散。
 */
export function TodoDragDock({ dragging, activeContainerId, projects, dropBlocked }: TodoDragDockProps) {
  const targets = todoDockTargets(activeContainerId ?? "", projects);
  return (
    <ul
      data-testid="todo-drag-dock"
      aria-hidden={!dragging}
      className={`fixed right-2 top-1/2 z-[var(--z-dropdown)] flex max-h-[calc(100vh-6rem)] -translate-y-1/2 flex-col items-end gap-2 overflow-y-auto transition-opacity ${
        dragging ? "pointer-events-auto opacity-95 delay-300" : "pointer-events-none opacity-0 delay-0"
      }`}
      style={{ transitionDuration: dragging ? "var(--duration-base)" : "0ms" }}
    >
      {targets.map((target) => (
        <DockPill
          key={todoDockId(target)}
          target={target}
          label={dockTargetLabel(target, projects)}
          blocked={target.kind === "project" && dropBlocked === true}
        />
      ))}
    </ul>
  );
}
