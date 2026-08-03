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
  /** 是否处于 dock 车道（左拉过阈值）：true=完整坞并接投递；false 且 dragging=细提示条。 */
  dockEngaged: boolean;
  /** 被拖行的 dnd 容器 id,决定隐藏哪个池药丸;null = 未在拖拽。 */
  activeContainerId: string | null;
  projects: readonly TodoDockProject[];
  /** 拖拽中的行不允许入项目时,项目药丸置禁用视觉(与项目卡 data-drop-blocked 同源判定)。 */
  dropBlocked: boolean | null;
  /**
   * 被拖子任务的父是否在手头。透传给 `todoDockTargets` 判定层——手头区整个区都不出坞，
   * 子任务要与父行（`activeContainerId === "hand"`）保持一致（见 todoDockTargets 注释）。
   * 非子任务或未在拖拽时无意义，默认 false。
   */
  activeParentInHand?: boolean;
  /**
   * 坞的左缘锚点(视口坐标 px):拖起时按**来源栏左缘**定位——拖柄在行左 2/5,
   * 锚右缘意味着全程向右横穿,恰是缩进手势(+28px 变子任务)的方向,极易误触;
   * 锚来源栏左缘让行程向左,缩进阈值永远不会被拖向坞的手势触发。null 退回视口右缘。
   */
  anchorLeftPx?: number | null;
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
function DockPill({ target, label, blocked, engaged }: { target: TodoDockTarget; label: string; blocked: boolean; engaged: boolean }) {
  const id = todoDockId(target);
  // disabled 的 droppable 不参与任何碰撞（pointerWithin/closestCenter 都不产出）——
  // 隐身/细条态的坞因此绝不接投递,这是"排序/收纳不被拦"的机制保证,不是视觉让路。
  const { setNodeRef, isOver } = useDroppable({ id, data: { containerId: id }, disabled: !engaged });
  return (
    <li
      ref={setNodeRef}
      data-testid="todo-dock-pill"
      data-dock-id={id}
      data-drop-blocked={blocked}
      data-dock-engaged={engaged}
      className={`flex w-full items-center gap-2 rounded-row border px-3 py-2.5 td-text-label transition duration-150 group-data-[dock-state=hint]:opacity-0 ${
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
 * - 三形态只切透明度/pointer-events/disabled,容器恒 w-44:droppable rect 在拖起时测量,
 *   改宽或晚挂载都会让 dock 档的命中区错位(常驻挂载铁律,与旧版同因)。
 * - pointer-events 只在拖拽中放开:dnd-kit 命中走指针坐标不吃 DOM 事件,但坞内滚动要接滚轮——
 *   恒 none 时滚轮穿透到页面,超出一屏的项目按钮在拖拽中永远够不到;平时 none,不拦点击。
 * - 原 300ms 淡入延迟取消:出坞已有显式左拉信号,"短距重排闪坞"不复存在;
 *   细条/完整坞均 150ms 快速淡入,一拉就到。
 * - overflow-x-hidden 是硬约束:纵向 overflow 会把横向 visible 自动算成 auto,任何内容溢出
 *   都会在坞里生出横向滚动条。
 */
export function TodoDragDock({
  dragging,
  dockEngaged,
  activeContainerId,
  projects,
  dropBlocked,
  anchorLeftPx = null,
  activeParentInHand = false,
}: TodoDragDockProps) {
  const targets = todoDockTargets(activeContainerId ?? "", projects, activeParentInHand);
  // 空坞（手头源/父在手头）连细条都不出：细条是坞的预告,无坞则无预告。
  const state = !dragging || targets.length === 0 ? "hidden" : dockEngaged ? "engaged" : "hint";
  return (
    <ul
      data-testid="todo-drag-dock"
      data-dock-state={state}
      aria-hidden={state !== "engaged"}
      className={`group fixed top-1/2 z-[var(--z-dropdown)] flex w-44 max-h-[calc(100vh-6rem)] -translate-y-1/2 flex-col gap-1.5 overflow-y-auto overflow-x-hidden transition-opacity duration-150 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:rounded-pill before:bg-accent before:opacity-0 before:transition-opacity before:duration-150 ${
        anchorLeftPx === null ? "right-3" : ""
      } ${
        state === "hidden"
          ? "pointer-events-none opacity-0"
          : state === "hint"
            ? "pointer-events-none opacity-100 before:opacity-60"
            : "pointer-events-auto opacity-100"
      }`}
      style={anchorLeftPx === null ? undefined : { left: anchorLeftPx }}
    >
      {targets.map((target) => (
        <DockPill
          key={todoDockId(target)}
          target={target}
          label={dockTargetLabel(target, projects)}
          blocked={target.kind === "project" && dropBlocked === true}
          engaged={state === "engaged"}
        />
      ))}
    </ul>
  );
}
