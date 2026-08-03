import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { hasParentRoute } from "../lib/backNavigation.ts";
import { EDGE_WIDTH_PX, resolveEdgeSwipeEnd, shouldStartEdgeSwipe } from "../lib/edgeSwipe.ts";

const SETTLE_MS = 200;
const CANCEL_MS = 180;
/** 被「未保存就别走」守卫拦下时，等用户抉择的上限；超时即复位，防止页面卡在滑出态。 */
const BLOCKED_TIMEOUT_MS = 8000;
const KEPT_PARALLAX = 0.25;
const OVERLAY_MAX_OPACITY = 0.25;

type Layers = { active: HTMLElement; kept: HTMLElement; overlay: HTMLElement };

/**
 * 取 KeptRouteStack 渲染出的三层。**缺保留层就返回 null**——栈只有一层时它根本不渲染
 * `[data-kept-layer="kept"]`（POP 到栈外也会重置成一层），此时无处可退，手势必须不启动。
 */
function readLayers(): Layers | null {
  const active = document.querySelector<HTMLElement>('[data-kept-layer="active"]');
  const kept = document.querySelector<HTMLElement>('[data-kept-layer="kept"]');
  const overlay = document.querySelector<HTMLElement>("[data-kept-overlay]");
  return active && kept && overlay ? { active, kept, overlay } : null;
}

function resetLayers(layers: Layers): void {
  for (const el of [layers.active, layers.kept]) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.willChange = "";
  }
  layers.overlay.style.transition = "";
  layers.overlay.style.opacity = "0";
}

/** 触点链路上有横向可滚容器或拖柄就让路——拖任务、横滑内容优先于返回。 */
function pathBlocksSwipe(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.hasAttribute("data-edge-swipe-block")) return true;
    const style = window.getComputedStyle(el);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * iOS 左边缘右滑返回。跟手位移直接写 DOM style，**不走 React state**——
 * 每帧 setState 会重渲染整棵页面树，60fps 必掉。
 *
 * 返回一律走 navigate(-1)：复用同一条历史记录，KeptRouteStack 才能凭 location.key
 * 复用保留层而不重新挂载。改成 navigate(父页, {replace}) 会静默毁掉整套机制。
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
  /** 已发出 navigate(-1)、等 location 变化的那一刻的 key；null 表示没有等待中的返回。 */
  const pendingKeyRef = useRef<string | null>(null);

  // 导航真的发生了 → 手势收尾完成，清掉两层的临时样式（React 不管我们手写的 inline style）。
  useEffect(() => {
    if (pendingKeyRef.current === null) return;
    if (pendingKeyRef.current === location.key) return;
    pendingKeyRef.current = null;
    const layers = readLayers();
    if (layers) requestAnimationFrame(() => resetLayers(layers));
  }, [location]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocityX = 0;
    let tracking = false;
    let engaged = false;
    let layers: Layers | null = null;
    let blockedTimer: number | null = null;

    const width = () => window.innerWidth || 1;

    function paint(dx: number): void {
      if (!layers) return;
      const clamped = Math.max(0, Math.min(dx, width()));
      const progress = clamped / width();
      layers.active.style.transform = `translateX(${clamped}px)`;
      layers.kept.style.transform = `translateX(${-width() * KEPT_PARALLAX * (1 - progress)}px)`;
      layers.overlay.style.opacity = String(OVERLAY_MAX_OPACITY * (1 - progress));
    }

    function onTouchStart(event: TouchEvent): void {
      tracking = false;
      engaged = false;
      const point = event.touches[0];
      if (!point) return;
      if (point.clientX > EDGE_WIDTH_PX) return;
      if (!hasParentRoute(locationRef.current.pathname)) return;
      // 目标详情页是一张可自由拖动的关系图，与右滑同方向，整页停用手势。
      if (/^\/goals\/[^/]+$/.test(locationRef.current.pathname)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (pathBlocksSwipe(event.target)) return;
      const found = readLayers();
      if (!found) return; // 没有保留层 = 不是从上一页钻进来的，无处可退

      layers = found;
      startX = point.clientX;
      startY = point.clientY;
      lastX = point.clientX;
      lastT = event.timeStamp;
      velocityX = 0;
      tracking = true;
    }

    function onTouchMove(event: TouchEvent): void {
      if (!tracking || !layers) return;
      const point = event.touches[0];
      if (!point) return;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;

      if (!engaged) {
        if (!shouldStartEdgeSwipe({ startX, dx, dy })) {
          if (Math.abs(dy) > Math.abs(dx)) tracking = false; // 判成纵向滚动，彻底让路
          return;
        }
        engaged = true;
        layers.kept.style.visibility = "visible";
        for (const el of [layers.active, layers.kept]) {
          el.style.transition = "";
          el.style.willChange = "transform";
        }
      }

      const dt = event.timeStamp - lastT;
      if (dt > 0) velocityX = (point.clientX - lastX) / dt;
      lastX = point.clientX;
      lastT = event.timeStamp;

      // 接管这一笔手势：不 preventDefault 会同时触发纵向滚动与 WebView 回弹。
      event.preventDefault();
      paint(dx);
    }

    function settle(complete: boolean): void {
      if (!layers) return;
      const current = layers;
      const ms = complete ? SETTLE_MS : CANCEL_MS;
      for (const el of [current.active, current.kept]) el.style.transition = `transform ${ms}ms ease-out`;
      current.overlay.style.transition = `opacity ${ms}ms ease-out`;

      if (complete) {
        current.active.style.transform = `translateX(${width()}px)`;
        current.kept.style.transform = "translateX(0)";
        current.overlay.style.opacity = "0";
        const onDone = () => {
          current.active.removeEventListener("transitionend", onDone);
          pendingKeyRef.current = locationRef.current.key;
          navigateRef.current(-1);
          // 守卫（/diary 的未保存拦截）可能把导航挡下：location 不变就复位，别卡在滑出态。
          blockedTimer = window.setTimeout(() => {
            if (pendingKeyRef.current !== null) {
              pendingKeyRef.current = null;
              resetLayers(current);
              current.kept.style.visibility = "hidden";
            }
          }, BLOCKED_TIMEOUT_MS);
        };
        current.active.addEventListener("transitionend", onDone);
      } else {
        current.active.style.transform = "translateX(0)";
        current.kept.style.transform = `translateX(${-width() * KEPT_PARALLAX}px)`;
        current.overlay.style.opacity = "0";
        const onDone = () => {
          current.active.removeEventListener("transitionend", onDone);
          resetLayers(current);
          current.kept.style.visibility = "hidden";
        };
        current.active.addEventListener("transitionend", onDone);
      }
      layers = null;
      tracking = false;
      engaged = false;
    }

    function onTouchEnd(event: TouchEvent): void {
      if (!tracking || !layers) {
        tracking = false;
        return;
      }
      if (!engaged) {
        tracking = false;
        layers = null;
        return;
      }
      const point = event.changedTouches[0];
      const dx = (point?.clientX ?? lastX) - startX;
      settle(resolveEdgeSwipeEnd({ dx, velocityX, viewportWidth: width() }) === "complete");
    }

    // passive:false —— touchmove 里要 preventDefault 拦掉纵向滚动与回弹。
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      if (blockedTimer !== null) window.clearTimeout(blockedTimer);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return null;
}
