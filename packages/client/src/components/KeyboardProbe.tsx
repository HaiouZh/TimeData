import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { useBottomNav } from "../contexts/BottomNavContext.tsx";
import { getKeyboardPlatform, subscribeKeyboardEvents, useKeyboardMotion } from "../hooks/useKeyboardHeight.ts";
import { CURRENT_BUILD_ID } from "../lib/frontendUpdate.js";
import { createKeyboardProbeTracker, readProbeSwitch, writeProbeSwitch } from "../lib/keyboard/kbdProbe.js";
import { stashPendingReport } from "../lib/recovery/pendingReports.js";

/** 设置页翻开关后广播这个事件，本组件与读数浮层据此重读开关（不用重启 App）。 */
export const KEYBOARD_PROBE_SWITCH_EVENT = "td:keyboard-probe";

function subscribeSwitch(onChange: () => void): () => void {
  window.addEventListener(KEYBOARD_PROBE_SWITCH_EVENT, onChange);
  return () => window.removeEventListener(KEYBOARD_PROBE_SWITCH_EVENT, onChange);
}

/** 探针开关是否打开（订阅设置页的广播）。浮层复用。 */
export function useKeyboardProbeEnabled(): boolean {
  return useSyncExternalStore(
    subscribeSwitch,
    () => readProbeSwitch().on,
    () => false,
  );
}

function readOs(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const m = /Android (\d+(?:\.\d+)?)|OS (\d+(?:_\d+)?) like Mac/.exec(ua);
  return (m?.[1] ?? m?.[2] ?? "").replace("_", ".");
}

function readScroll(): { scrollY: number; vvTop: number } {
  return { scrollY: window.scrollY, vvTop: window.visualViewport?.offsetTop ?? 0 };
}

function isEditable(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.matches("input, textarea, [contenteditable]");
}

/**
 * 键盘探针接线（mobile-keyboard R7，design §2.4）：把 store 广播的插件 / 焦点事件、驻坞条的
 * transition 事件、「事件到下一帧」的延迟（主线程堵没堵）攒成一条 kbd_session，走 pendingReports
 * 搭同步车上报（服务端零改动）。逻辑与用例在 lib/keyboard/kbdProbe.ts，这里只接线。
 *
 * 开关关着时**不挂任何监听**（零痕迹）；开着时每条落库后扣预算，扣完自动关。
 * 常驻 AppShell；useKeyboardMotion 的订阅顺带保证 store 在监听（探针不自己听插件）。
 */
export function KeyboardProbe() {
  const location = useLocation();
  const motion = useKeyboardMotion();
  const { hidden: navHidden } = useBottomNav();
  const enabled = useKeyboardProbeEnabled();
  // tracker 通过 ref 读最新值，不因路由 / 底栏 / 参数变化而重建（重建会丢正在记的会话）。
  const latestRef = useRef({ route: location.pathname, motion, navHidden });
  latestRef.current = { route: location.pathname, motion, navHidden };

  useEffect(() => {
    if (!enabled) return;
    const tracker = createKeyboardProbeTracker({
      platform: getKeyboardPlatform(),
      os: readOs(),
      build: CURRENT_BUILD_ID,
      route: () => latestRef.current.route,
      motion: () => latestRef.current.motion,
      stash: (report) => {
        stashPendingReport(report);
      },
      readSwitch: readProbeSwitch,
      writeSwitch: writeProbeSwitch,
      navCollapsed: () => latestRef.current.navHidden,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    });

    // 首帧延迟：事件到下一次 rAF 隔了多久。>50ms = 主线程被同帧的重排 / 脚本堵住了，正是「卡一下」的读数。
    const measureFrame = () => {
      const at = performance.now();
      requestAnimationFrame((frameAt) => {
        tracker.push({ type: "ff", t: frameAt, frameMs: frameAt - at, ...readScroll() });
      });
    };

    // 捕获阶段先于 store 的 window 监听跑：fi 到达 tracker 前先分类聚焦目标（驻坞条内 / 页面内）。
    const onFocusInCapture = (event: FocusEvent) => {
      if (!isEditable(event.target)) return;
      tracker.focusTarget(Boolean(event.target.closest("[data-kbd-dock]")));
    };
    document.addEventListener("focusin", onFocusInCapture, true);

    const offStore = subscribeKeyboardEvents((e) => {
      tracker.push({ type: e.type, t: e.t, height: e.height, ...readScroll() });
      if (e.type === "ws" || e.type === "wh") measureFrame();
    });

    const onTransition = (type: "ts" | "te") => (ev: Event) => {
      if (!(ev.target instanceof HTMLElement) || !ev.target.hasAttribute("data-kbd-dock")) return;
      tracker.push({ type, t: performance.now(), ...readScroll() });
    };
    const onStart = onTransition("ts");
    const onEnd = onTransition("te");
    document.addEventListener("transitionstart", onStart, true);
    document.addEventListener("transitionend", onEnd, true);

    // 视觉视口滚动 = 引擎在平移视口（reveal-pan / iOS 滚文档）的直接证据。
    const onVvScroll = () => tracker.push({ type: "vs", t: performance.now(), ...readScroll() });
    window.visualViewport?.addEventListener("scroll", onVvScroll);

    return () => {
      offStore();
      document.removeEventListener("focusin", onFocusInCapture, true);
      document.removeEventListener("transitionstart", onStart, true);
      document.removeEventListener("transitionend", onEnd, true);
      window.visualViewport?.removeEventListener("scroll", onVvScroll);
      tracker.dispose();
    };
  }, [enabled]);

  return null;
}
