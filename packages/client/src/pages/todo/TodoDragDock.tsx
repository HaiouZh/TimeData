import { useDroppable } from "@dnd-kit/core";
import { Folder, HandGrabbing, Sun, Tray } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
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

function dockTargetIcon(target: TodoDockTarget) {
  if (target.kind === "pool") return target.pool === "today" ? Sun : Tray;
  if (target.kind === "hand") return HandGrabbing;
  return Folder;
}

/**
 * 命中态是**实心 accent 填充**而不是缩放:缩放会把最宽的药丸顶出容器,而容器为纵向滚动
 * 设了 overflow,横向随之自动变 auto——真机上表现为坞里闪出横向滚动条(验收退回项)。
 */
function DockPill({ target, label, blocked }: { target: TodoDockTarget; label: string; blocked: boolean }) {
  const id = todoDockId(target);
  const { setNodeRef, isOver } = useDroppable({ id, data: { containerId: id } });
  return (
    <li
      ref={setNodeRef}
      data-testid="todo-dock-pill"
      data-dock-id={id}
      data-drop-blocked={blocked}
      className={`flex w-full items-center gap-2 rounded-row border px-3 py-2.5 td-text-label transition-colors ${
        blocked
          ? "border-border bg-surface text-ink-3 opacity-60"
          : isOver
            ? "border-accent bg-accent text-page shadow-elev2"
            : "border-border-strong bg-surface-elevated text-ink shadow-elev1"
      }`}
    >
      <Icon icon={dockTargetIcon(target)} size={16} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </li>
  );
}

/**
 * 拖拽投递坞:拖起任务时视口右缘淡入的一列瞬态落点按钮(design spec 2026-07-28-todo-drag-dock,
 * 验收后按用户反馈从小药丸改成等宽大按钮:落点要大、命中要一眼可见)。
 * - 常驻挂载、只切透明度:避开 dnd-kit 拖拽中挂载 droppable 的测量时序。
 * - pointer-events 只在拖拽中放开:dnd-kit 命中走指针坐标不吃 DOM 事件,但坞内滚动要接滚轮——
 *   恒 none 时滚轮穿透到页面,超出一屏的项目按钮在拖拽中永远够不到;平时 none,不拦点击。
 * - 淡入 300ms 延迟(CSS delay,不用计时器):列表内短距重排不会闪出坞;隐藏 duration 0 = 松手即散。
 * - overflow-x-hidden 是硬约束:纵向 overflow 会把横向 visible 自动算成 auto,任何内容溢出
 *   都会在坞里生出横向滚动条。
 */
export function TodoDragDock({ dragging, activeContainerId, projects, dropBlocked }: TodoDragDockProps) {
  const targets = todoDockTargets(activeContainerId ?? "", projects);
  return (
    <ul
      data-testid="todo-drag-dock"
      aria-hidden={!dragging}
      className={`fixed right-3 top-1/2 z-[var(--z-dropdown)] flex w-44 max-h-[calc(100vh-6rem)] -translate-y-1/2 flex-col gap-1.5 overflow-y-auto overflow-x-hidden transition ${
        dragging
          ? "pointer-events-auto translate-x-0 opacity-100 delay-300"
          : "pointer-events-none translate-x-2 opacity-0 delay-0"
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
