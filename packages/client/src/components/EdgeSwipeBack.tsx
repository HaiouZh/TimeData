import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { hasParentRoute } from "../lib/backNavigation.ts";
import { EDGE_WIDTH_PX, resolveEdgeSwipeEnd, resolveEdgeSwipeIntent } from "../lib/edgeSwipe.ts";

/** 松手判定「完成」后补完剩余行程的时长（ms）。 */
const SETTLE_MS = 200;
/** 取消 / 被守卫拦下时弹回原位的时长（ms）。 */
const CANCEL_MS = 180;
/**
 * 发出 `navigate(-1)` 后等 location 变化的上限（ms）。
 * 不能只看一帧：history 的 back 是异步的，正常路径下 location 也要晚一两帧才更新，一帧就判「被拦」会误伤。
 * 也不能等很久：被「未保存就别走」守卫拦下时，当前页停在屏外、屏上铺的是带 `inert` 的上一页，
 * 用户点哪都没反应——超时即弹回，把那一屏立刻还给用户。
 */
const NAV_CONFIRM_TIMEOUT_MS = 500;
const KEPT_PARALLAX = 0.25;
const OVERLAY_MAX_OPACITY = 0.25;

interface Layers {
  active: HTMLElement;
  kept: HTMLElement;
  overlay: HTMLElement;
}

/**
 * 取 KeptRouteStack 渲染出的三层。**缺保留层就返回 null**——栈只有一层时它根本不渲染
 * `[data-kept-layer="kept"]`（POP 到栈外也会重置成一层），此时无处可退，手势必须不启动。
 *
 * 只在**起手**时用。收尾清理一律用起手时捕获的元素引用，绝不再查一次 DOM：
 * 成功返回后栈就截断成一层，这个函数在成功路径上恒返回 null。
 */
function readLayers(): Layers | null {
  const active = document.querySelector<HTMLElement>('[data-kept-layer="active"]');
  const kept = document.querySelector<HTMLElement>('[data-kept-layer="kept"]');
  const overlay = document.querySelector<HTMLElement>("[data-kept-overlay]");
  return active && kept && overlay ? { active, kept, overlay } : null;
}

/**
 * 位移基准取**层自身**的宽度，不是 `window.innerWidth`：iPad 上 `getPlatform()` 同样是 ios，
 * 而层是桌面侧栏旁边的 flex 子项，宽度 = 窗口宽 − 侧栏宽。用窗口宽会让完成阈值偏大（要多拖一截才返回）、
 * 视差起点算错、progress 永远到不了 1（遮罩褪不干净）。
 *
 * 量不到（尚未布局 / jsdom）才退回窗口宽；再拿不到正数就返回 0 让调用方**放弃起手**。
 * 不许用 `|| 1` 之类的兜底：宽度 1 会把完成阈值变成 0.33px，手指动一下就判「完成」——
 * 比手势整个不可用危险得多。
 */
function measureWidth(el: HTMLElement): number {
  const rect = el.getBoundingClientRect().width;
  const width = rect > 0 ? rect : window.innerWidth;
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * 触点链路上有显式让路标记就不起手。
 *
 * **只认标记，不看 `overflow-x` 的计算值**：CSS 规定 `overflow-y` 非 visible 时，
 * `overflow-x: visible` 的计算值会被改写成 `auto`，而每层的 `<main>` 正是 `overflow-y-auto`——
 * 于是「祖先里有 overflowX==='auto'」恒成立，真正的横滚容器与普通竖滚容器再也分不开，
 * 能否起手完全押在 `scrollWidth > clientWidth` 上：任何子页只要内容横向溢出 1px，整页手势静默失效。
 * 真正需要让路的元素（dnd-kit 拖柄、横滚容器）一律显式标 `data-edge-swipe-block`。
 */
function pathBlocksSwipe(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-edge-swipe-block]") !== null;
}

/** 手势状态机的四态。任何时刻有且只有一个。 */
type Phase =
  /** 没有在跟的手势。 */
  | "idle"
  /** 边缘落点已通过全部生效条件，但位移还没过 slop——方向未定，不碰 DOM、不拦事件。 */
  | "tracking"
  /** 判定为横向返回手势，接管这一笔：每条 touchmove 直写两层的 transform。 */
  | "engaged"
  /** 手已离开（或被打断），rAF 逐帧插值收尾中。此期间不接新手势。 */
  | "settling";

interface Gesture {
  layers: Layers;
  /** 起手瞬间量一次的层宽。阈值、视差、遮罩共用它，中途不重量，免得量测抖动让动画跳。 */
  width: number;
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  velocityX: number;
  /** 当前已画到的位移。收尾动画从这里起步，松手瞬间才不会跳一下。 */
  dx: number;
}

/**
 * iOS 左边缘右滑返回。
 *
 * **跟手位移直接写 DOM style，不走 React state**——每帧 setState 会重渲染整棵页面树，60fps 必掉。
 *
 * **返回一律走 `navigate(-1)`**：复用同一条历史记录，KeptRouteStack 才能凭 `location.key`
 * 复用保留层而不重新挂载。改成 `navigate(父页, { replace: true })` 会静默毁掉整套机制
 * （新 key → 保留层被当新页重挂 → 滚动位置与组件 state 全丢）。
 *
 * **收尾靠 rAF 逐帧插值，不靠 CSS transition + `transitionend`。** 那个底座有四个无法靠补丁修好的死角：
 * 首末值相同就不产生过渡（拉回起点再松手 → 收尾永不触发，两层永久冻住）；
 * `transitionend` 会冒泡且携带页面内任意元素的 `transition-colors`（按钮变色也会被当成「滑动结束」）；
 * 打断过渡发的是 `transitioncancel` 不是 `transitionend`，旧监听永久挂着，下次一起烧；
 * 以及浏览器根本不保证事件必达。rAF 自己把进度数到 1，判定是确定性的。
 *
 * 手势期间把保留层的 visibility 手改成 visible，但它的 `inert`（React 渲染的属性）原封不动，
 * 故整层照样不吃指针事件、不进焦点序——不必额外加 pointer-events。
 */
export default function EdgeSwipeBack() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;

    let phase: Phase = "idle";
    let gesture: Gesture | null = null;
    let frame: number | null = null;

    function stopFrames(): void {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    }

    /**
     * 帧循环。`step` 返回 true 表示还要下一帧。
     * 时间只从 rAF 回调的时间戳参数读——不读时钟、不用定时器、不等任何事件，
     * 因此每条收尾路径都是确定性的（测试里手工喂时间戳即可走完）。
     * 同一时刻只允许一个循环：新的一开就把旧的取消，杜绝两条动画同时写同一批元素。
     */
    function runFrames(step: (now: number) => boolean): void {
      stopFrames();
      const tick = (now: number): void => {
        frame = null;
        if (step(now)) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    /** 跟手与收尾共用的唯一一处画法。分成两处写就会像旧实现那样漏掉 px 单位而整条路径失效。 */
    function paint(g: Gesture, dx: number): void {
      const clamped = Math.max(0, Math.min(dx, g.width));
      const progress = clamped / g.width;
      g.dx = clamped;
      g.layers.active.style.transform = `translateX(${clamped}px)`;
      g.layers.kept.style.transform = `translateX(${-g.width * KEPT_PARALLAX * (1 - progress)}px)`;
      g.layers.overlay.style.opacity = String(OVERLAY_MAX_OPACITY * (1 - progress));
    }

    /**
     * 清掉我们写过的 inline style。**只认传进来的元素引用。**
     *
     * 一旦改成「重新查三层」，成功路径上就恒查不到（栈已截断、kept 消失），
     * `transform` 与 `will-change: transform` 会永久留在幸存层上。二者都会让该层成为
     * `position: fixed` 后代的**包含块**——本仓大量整屏浮层直接渲染在页面树里、没走 portal，
     * 被包含后定位基准从视口变成被安全区内缩的层盒，用过一次返回手势整屏浮层就盖不住状态栏了。
     *
     * `hideKept`：只有取消 / 被拦下才置 true。`visibility` 是 React 用 style prop 管的，
     * 保留层的 prop 值恒为 hidden，我们手改成 visible 后 React 不会回写（prop 没变），得自己改回去。
     * 但**导航成功那条路径绝不能碰**：那一层已经升为当前层，React 刚把它写成 visible，
     * 这里再写 hidden 就是黑屏。
     */
    function resetLayers(layers: Layers, hideKept: boolean): void {
      for (const el of [layers.active, layers.kept]) {
        el.style.transform = "";
        el.style.willChange = "";
      }
      layers.overlay.style.opacity = "0";
      if (hideKept) layers.kept.style.visibility = "hidden";
    }

    function finish(hideKept: boolean): void {
      if (gesture) resetLayers(gesture.layers, hideKept);
      gesture = null;
      phase = "idle";
    }

    /** 从当前位移插值到 `to`，到位后执行 `onDone`。进度由帧时间戳算，与浏览器事件无关。 */
    function animate(g: Gesture, to: number, durationMs: number, onDone: () => void): void {
      phase = "settling";
      const from = g.dx;
      let startedAt: number | null = null;
      runFrames((now) => {
        startedAt ??= now;
        const t = durationMs > 0 ? Math.min(1, (now - startedAt) / durationMs) : 1;
        const eased = 1 - (1 - t) ** 3; // ease-out
        paint(g, from + (to - from) * eased);
        if (t < 1) return true;
        onDone();
        return false;
      });
    }

    function settleCancel(g: Gesture): void {
      animate(g, 0, CANCEL_MS, () => finish(true));
    }

    function settleComplete(g: Gesture): void {
      animate(g, g.width, SETTLE_MS, () => {
        const keyBefore = locationRef.current.key;
        navigateRef.current(-1);
        let deadline: number | null = null;
        runFrames((now) => {
          deadline ??= now + NAV_CONFIRM_TIMEOUT_MS;
          // 导航真的发生了。幸存层已由 React 升为当前层并写成 visible，这里只清 transform / will-change。
          if (locationRef.current.key !== keyBefore) {
            finish(false);
            return false;
          }
          if (now < deadline) return true;
          // 被「未保存就别走」守卫拦下：当场弹回原位，别让用户对着不吃点击的屏幕干等。
          // 兜底逻辑活在**本次手势的闭包里**、且与动画共用同一个帧循环，
          // 所以下一笔手势一开始（runFrames 会取消旧循环）它就彻底作废，不可能认领别人的状态。
          settleCancel(g);
          return false;
        });
      });
    }

    function releaseIdle(): void {
      gesture = null;
      phase = "idle";
    }

    /** 本笔手势必须有交代：已跟手就播取消收尾，没跟手就直接释放；收尾中的不打断（rAF 必然把它数完）。 */
    function abort(): void {
      if (phase === "engaged" && gesture) settleCancel(gesture);
      else if (phase === "tracking") releaseIdle();
    }

    function onTouchStart(event: TouchEvent): void {
      // 收尾动画在飞、或第二根手指落下：先把上一笔交代干净，本次不再起手。
      // 旧实现在这里无条件重置 tracking/engaged 却不收尾也不清层，抬手时又被 `!tracking` 早退挡掉，
      // 于是两层永久冻在半途，而 React 不会回写（style prop 值没变），只能靠手动导航一次才恢复。
      if (phase !== "idle") {
        abort();
        return;
      }
      if (event.touches.length > 1) return;
      const point = event.touches[0];
      if (!point) return;
      if (point.clientX > EDGE_WIDTH_PX) return;
      if (!hasParentRoute(locationRef.current.pathname)) return;
      // 目标详情页是一张可自由拖动的关系图，与右滑同方向，整页停用手势。
      if (/^\/goals\/[^/]+$/.test(locationRef.current.pathname)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (pathBlocksSwipe(event.target)) return;
      const layers = readLayers();
      if (!layers) return; // 没有保留层 = 不是从上一页钻进来的，无处可退
      const width = measureWidth(layers.active);
      if (width <= 0) return;

      gesture = {
        layers,
        width,
        startX: point.clientX,
        startY: point.clientY,
        lastX: point.clientX,
        lastT: event.timeStamp,
        velocityX: 0,
        dx: 0,
      };
      phase = "tracking";
    }

    function onTouchMove(event: TouchEvent): void {
      const g = gesture;
      if (!g || (phase !== "tracking" && phase !== "engaged")) return;
      if (event.touches.length > 1) {
        abort();
        return;
      }
      const point = event.touches[0];
      if (!point) return;
      const dx = point.clientX - g.startX;
      const dy = point.clientY - g.startY;

      if (phase === "tracking") {
        const intent = resolveEdgeSwipeIntent({ startX: g.startX, dx, dy });
        if (intent === "pending") return; // 还没到 slop：不判方向、不拦事件，纵向滚动照常
        if (intent === "abandon") {
          releaseIdle(); // 判成纵向：整笔作废，之后再拐成横向也不接
          return;
        }
        phase = "engaged";
        g.layers.kept.style.visibility = "visible";
        for (const el of [g.layers.active, g.layers.kept]) el.style.willChange = "transform";
      }

      const dt = event.timeStamp - g.lastT;
      if (dt > 0) g.velocityX = (point.clientX - g.lastX) / dt;
      g.lastX = point.clientX;
      g.lastT = event.timeStamp;

      // 接管这一笔手势：不 preventDefault 会同时触发纵向滚动与 WebView 回弹。
      event.preventDefault();
      paint(g, dx);
    }

    function onTouchEnd(event: TouchEvent): void {
      const g = gesture;
      if (!g) return;
      if (phase === "tracking") {
        releaseIdle();
        return;
      }
      if (phase !== "engaged") return;
      const point = event.changedTouches[0];
      const dx = (point?.clientX ?? g.lastX) - g.startX;
      if (resolveEdgeSwipeEnd({ dx, velocityX: g.velocityX, viewportWidth: g.width }) === "complete") settleComplete(g);
      else settleCancel(g);
    }

    /**
     * 系统打断（来电、控制中心、系统手势）——**恒按取消收尾**。
     * 它的 `changedTouches` 与正常抬手同形，跟 touchend 共用处理器就会照样算出 dx 并可能判成「完成」：
     * 用户根本没松手，页面自己退了。
     */
    function onTouchCancel(): void {
      const g = gesture;
      if (!g) return;
      if (phase === "tracking") releaseIdle();
      else if (phase === "engaged") settleCancel(g);
    }

    // passive:false —— touchmove 里要 preventDefault 拦掉纵向滚动与回弹。
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      stopFrames();
      // 卸载时若还有在飞的手势，把两层还原——否则残留的 transform 会跟着幸存的 DOM 一起留下。
      if (gesture) resetLayers(gesture.layers, true);
      gesture = null;
      phase = "idle";
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []);

  return null;
}
