import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Icon } from "../../components/Icon.js";
import { prefersReducedMotion } from "../../lib/prefersReducedMotion.js";
import {
  ROW_SWIPE_ACTION_WIDTH_PX,
  ROW_SWIPE_SETTLE_EASING,
  ROW_SWIPE_SETTLE_MS,
  type RowSwipeRest,
  type RowSwipeWidths,
  releaseVelocity,
  resolveRowSwipeEnd,
  resolveRowSwipeIntent,
  rowSwipeDragOffset,
  rowSwipeRestOffset,
} from "./rowSwipe.js";

export interface SwipeRowAction {
  key: string;
  /** 无障碍名（按钮只有图标）。 */
  label: string;
  icon: PhosphorIcon;
  tone: "accent" | "neutral" | "danger";
  onTrigger: () => void;
}

const TONE_CLASS: Record<SwipeRowAction["tone"], string> = {
  accent: "bg-accent-strong text-page",
  neutral: "bg-surface-elevated text-ink",
  danger: "bg-danger text-page",
};

interface Gesture {
  startX: number;
  startY: number;
  startT: number;
  /** 起手时行已有的位移（从打开态接着拖）。 */
  base: number;
  lastX: number;
  lastT: number;
  velocityX: number;
  offset: number;
  phase: "tracking" | "engaged";
}

interface RowController {
  close: () => void;
  reset: () => void;
  isOpen: () => boolean;
}

/**
 * 触屏列表行：左右滑露出等宽图标动作条。
 *
 * 位移与动作条宽度**直写 DOM style**，不走 React state：每条 touchmove 都 setState 会整行重渲染，
 * 跟手必掉帧。也因此这几个元素**不得再加 style prop**——React 重渲染时会用 prop 值覆盖手写的位移。
 *
 * 手势用原生 touch 事件（非被动 touchmove 才能 preventDefault 拦住列表滚动），写法与
 * `EdgeSwipeBack` 同源：先过 slop 再判方向、方向只判一次、按事件时间戳算速度。判定算术在 `rowSwipe.ts`。
 */
export function SwipeActionRow({
  enabled,
  leading,
  trailing,
  children,
}: {
  /** false（桌面细指针 / 多选态）：不渲染动作条、不接手势，打开中的行立即复位。 */
  enabled: boolean;
  leading: readonly SwipeRowAction[];
  trailing: readonly SwipeRowAction[];
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<RowController | null>(null);
  const widths: RowSwipeWidths = {
    leading: leading.length * ROW_SWIPE_ACTION_WIDTH_PX,
    trailing: trailing.length * ROW_SWIPE_ACTION_WIDTH_PX,
  };
  // 监听器只装一次，现读这里的最新值，不随每次渲染重装。
  const liveRef = useRef({ enabled, widths });
  liveRef.current = { enabled, widths };

  useEffect(() => {
    if (!rowRef.current || !contentRef.current) return;
    // 显式标注非空：下面的处理器是函数声明（会提升），TS 不把 if 收窄带进去。
    const rowEl: HTMLDivElement = rowRef.current;
    const content: HTMLDivElement = contentRef.current;

    let rest: RowSwipeRest = null;
    let offset = 0;
    let gesture: Gesture | null = null;
    // 这一笔触摸之后的 click 要吞掉：打开态点行 = 只收回，滑动松手也不能顺带点开详情。
    let suppressClick = false;

    const strips = () => [leadingRef.current, trailingRef.current];

    function setTransition(animate: boolean): void {
      const on = animate && !prefersReducedMotion();
      content.style.transition = on ? `transform ${ROW_SWIPE_SETTLE_MS}ms ${ROW_SWIPE_SETTLE_EASING}` : "";
      for (const strip of strips()) {
        if (strip) strip.style.transition = on ? `width ${ROW_SWIPE_SETTLE_MS}ms ${ROW_SWIPE_SETTLE_EASING}` : "";
      }
    }

    function paint(next: number): void {
      offset = next;
      content.style.transform = `translateX(${next}px)`;
      if (leadingRef.current) leadingRef.current.style.width = `${Math.max(0, next)}px`;
      if (trailingRef.current) trailingRef.current.style.width = `${Math.max(0, -next)}px`;
    }

    /**
     * 关闭态不留 transform：transform 会让这一行成为 fixed 后代的包含块、并单开层叠上下文，
     * 行内的整屏浮层与 z-index 都会被它关进行盒子里（`EdgeSwipeBack.resetLayers` 同一条理由）。
     */
    function clearTransform(): void {
      content.style.transform = "";
      content.style.transition = "";
    }

    function onOutsideTouch(event: Event): void {
      if (event.target instanceof Node && rowEl.contains(event.target)) return;
      settle(null);
    }

    function onScroll(): void {
      settle(null);
    }

    function setRest(next: RowSwipeRest): void {
      if (next === rest) return;
      rest = next;
      if (next) {
        rowEl.setAttribute("data-swipe-open", next);
        // 碰别处（含另一行）或滚动即收回：同一时间只开一行靠这一条，不需要跨行登记。
        document.addEventListener("touchstart", onOutsideTouch, { capture: true, passive: true });
        document.addEventListener("scroll", onScroll, { capture: true, passive: true });
      } else {
        rowEl.removeAttribute("data-swipe-open");
        document.removeEventListener("touchstart", onOutsideTouch, { capture: true });
        document.removeEventListener("scroll", onScroll, { capture: true });
      }
    }

    function settle(next: RowSwipeRest): void {
      gesture = null;
      setRest(next);
      const target = rowSwipeRestOffset(next, liveRef.current.widths);
      // 已经停在原位：不补一段无变化的过渡（transitionend 不会来，transform 就清不掉了）。
      if (next === null && offset === 0) {
        clearTransform();
        return;
      }
      setTransition(true);
      paint(target);
      if (next === null && prefersReducedMotion()) clearTransform();
    }

    function reset(): void {
      gesture = null;
      setRest(null);
      offset = 0;
      clearTransform();
      for (const strip of strips()) {
        if (strip) {
          strip.style.width = "";
          strip.style.transition = "";
        }
      }
    }

    function onTransitionEnd(event: TransitionEvent): void {
      // 行内元素自己的过渡（悬停底色等）也会冒泡上来，只认内容层本身。
      if (event.target !== content || rest !== null || gesture !== null) return;
      clearTransform();
    }

    function onTouchStart(event: TouchEvent): void {
      suppressClick = false;
      if (!liveRef.current.enabled) return;
      if (event.touches.length > 1) {
        if (gesture?.phase === "engaged") settle(rest);
        gesture = null;
        return;
      }
      const point = event.touches[0];
      if (!point) return;
      // 按在动作按钮上：交给按钮自己的 click，不起手。
      if (event.target instanceof Node && strips().some((strip) => strip?.contains(event.target as Node))) return;
      suppressClick = rest !== null;
      const base = rowSwipeRestOffset(rest, liveRef.current.widths);
      gesture = {
        startX: point.clientX,
        startY: point.clientY,
        startT: event.timeStamp,
        base,
        lastX: point.clientX,
        lastT: event.timeStamp,
        velocityX: 0,
        offset: base,
        phase: "tracking",
      };
    }

    function onTouchMove(event: TouchEvent): void {
      const g = gesture;
      if (!g) return;
      const point = event.touches[0];
      if (!point || event.touches.length > 1) return;
      const dx = point.clientX - g.startX;
      const dy = point.clientY - g.startY;

      if (g.phase === "tracking") {
        const intent = resolveRowSwipeIntent({
          dx,
          dy,
          heldMs: event.timeStamp - g.startT,
          rest,
          widths: liveRef.current.widths,
        });
        if (intent === "pending") return;
        // 不可取消 = 浏览器已经开始滚动，这时再接只会一边滚一边滑。
        if (intent === "abandon" || !event.cancelable) {
          gesture = null;
          return;
        }
        g.phase = "engaged";
        suppressClick = true;
        setTransition(false);
      }

      const dt = event.timeStamp - g.lastT;
      if (dt > 0) g.velocityX = (point.clientX - g.lastX) / dt;
      g.lastX = point.clientX;
      g.lastT = event.timeStamp;

      event.preventDefault();
      g.offset = rowSwipeDragOffset(g.base + dx, liveRef.current.widths);
      paint(g.offset);
    }

    function onTouchEnd(event: TouchEvent): void {
      const g = gesture;
      if (!g || g.phase === "tracking") {
        gesture = null;
        // 打开态下的一次轻点（或没接的竖滑）：收回。
        if (suppressClick && rest !== null) settle(null);
        return;
      }
      const velocityX = releaseVelocity({ velocityX: g.velocityX, idleMs: event.timeStamp - g.lastT });
      settle(resolveRowSwipeEnd({ offset: g.offset, velocityX, widths: liveRef.current.widths }));
    }

    /** 系统打断（来电、系统手势）：恒回到起手前的停靠态，不按位置判——用户根本没松手。 */
    function onTouchCancel(): void {
      const g = gesture;
      gesture = null;
      if (g?.phase === "engaged") settle(rest);
    }

    function onClickCapture(event: MouseEvent): void {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    controllerRef.current = { close: () => settle(null), reset, isOpen: () => rest !== null };
    rowEl.addEventListener("touchstart", onTouchStart, { passive: true });
    rowEl.addEventListener("touchmove", onTouchMove, { passive: false });
    rowEl.addEventListener("touchend", onTouchEnd);
    rowEl.addEventListener("touchcancel", onTouchCancel);
    rowEl.addEventListener("click", onClickCapture, true);
    content.addEventListener("transitionend", onTransitionEnd);
    return () => {
      rowEl.removeEventListener("touchstart", onTouchStart);
      rowEl.removeEventListener("touchmove", onTouchMove);
      rowEl.removeEventListener("touchend", onTouchEnd);
      rowEl.removeEventListener("touchcancel", onTouchCancel);
      rowEl.removeEventListener("click", onClickCapture, true);
      content.removeEventListener("transitionend", onTransitionEnd);
      setRest(null);
      controllerRef.current = null;
    };
  }, []);

  // 打开中被禁用（进多选态）→ 立即复位；动作组数量变了（行换了池）→ 收回，别停在旧宽度上。
  const actionShape = `${leading.length}:${trailing.length}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies(actionShape): 触发器而非读取项——动作组数量一变就把打开中的行收回。删掉它，行会停在旧宽度上、露出半截或空白。
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!enabled) controller.reset();
    else if (controller.isOpen()) controller.close();
  }, [enabled, actionShape]);

  function trigger(action: SwipeRowAction): void {
    controllerRef.current?.close();
    action.onTrigger();
  }

  return (
    <div ref={rowRef} data-swipe-row="" className="todo-swipe-row relative w-full min-w-0 max-w-full">
      {enabled && leading.length > 0 && (
        <ActionStrip side="leading" actions={leading} stripRef={leadingRef} onTrigger={trigger} />
      )}
      {enabled && trailing.length > 0 && (
        <ActionStrip side="trailing" actions={trailing} stripRef={trailingRef} onTrigger={trigger} />
      )}
      {/* relative + 排在动作条之后：内容层恒压在动作条上面 */}
      <div ref={contentRef} data-swipe-content="" className="relative">
        {children}
      </div>
    </div>
  );
}

function ActionStrip({
  side,
  actions,
  stripRef,
  onTrigger,
}: {
  side: "leading" | "trailing";
  actions: readonly SwipeRowAction[];
  stripRef: RefObject<HTMLDivElement | null>;
  onTrigger: (action: SwipeRowAction) => void;
}) {
  return (
    // 宽度 = 当前露出的距离（直写 style），按钮 flex-1 均分：打开态恰为每个 56px，
    // 拖动中一起按比例展开；只放图标，窄了也只是被裁，不会像文字那样折行。
    <div
      ref={stripRef}
      data-swipe-actions={side}
      className={`absolute inset-y-0 ${side === "leading" ? "left-0" : "right-0"} flex w-0 overflow-hidden rounded-row`}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          aria-label={action.label}
          className={`flex h-full min-w-0 flex-1 items-center justify-center ${TONE_CLASS[action.tone]}`}
          onClick={(event) => {
            event.stopPropagation();
            onTrigger(action);
          }}
        >
          <Icon icon={action.icon} size={20} weight="regular" />
        </button>
      ))}
    </div>
  );
}
