import { type UIEvent, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useBottomNav } from "../contexts/BottomNavContext.js";
import { initialNavScrollState, resolveNavVisibility } from "../lib/navScroll.js";

/**
 * 把底部导航的「滚动隐藏」接到一个共享滚动容器上：返回挂到该容器的 onScroll。
 * 时间轴 / 统计 / 设置都走 AppShell 的 <main> 滚动，一处接线即可覆盖。
 *
 * - 滚动方向判定委托给纯函数 resolveNavVisibility（带滞回，已单测）。
 * - 路由切换时把导航重置为显示，并让下一次滚动重新取基线，避免跨页残留隐藏态 /
 *   因 scrollTop 落差误判方向。
 */
export function useHideBottomNavOnScroll(): (event: UIEvent<HTMLElement>) => void {
  const { setHidden } = useBottomNav();
  const { pathname } = useLocation();
  const stateRef = useRef(initialNavScrollState());
  const needsSeedRef = useRef(true);

  useEffect(() => {
    needsSeedRef.current = true;
    stateRef.current = initialNavScrollState();
    // 子页（/entries/*、/settings/*）本就不渲染底部导航，无需强制显示；
    // 其余主路由切换时回到显示，避免带着上一页的隐藏态进入新页。
    const hidesNav = pathname.startsWith("/entries/") || pathname.startsWith("/settings/");
    if (!hidesNav) setHidden(false);
  }, [pathname, setHidden]);

  return useCallback(
    (event: UIEvent<HTMLElement>) => {
      const scrollTop = event.currentTarget.scrollTop;

      if (needsSeedRef.current) {
        needsSeedRef.current = false;
        stateRef.current = initialNavScrollState(scrollTop, stateRef.current.hidden);
        return;
      }

      const next = resolveNavVisibility(stateRef.current, scrollTop);
      if (next.hidden !== stateRef.current.hidden) setHidden(next.hidden);
      stateRef.current = next;
    },
    [setHidden],
  );
}
