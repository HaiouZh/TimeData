import { Capacitor } from "@capacitor/core";
import { type CSSProperties, type HTMLAttributes, type ReactNode, useCallback, useEffect, useRef } from "react";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useKeyboardHeight, useKeyboardMotion, useKeyboardVisible } from "../hooks/useKeyboardHeight.ts";
import { useShellResizeGlide } from "../lib/keyboardMotion.ts";
import { useIsWideScreen } from "../lib/useIsWideScreen.ts";
import { Z } from "../lib/zLayers.ts";

/**
 * 键盘引起的底栏实体收起（两页共用的唯一实现，原 TodoPage 私有 effect 提升而来）。
 *
 * 只把「这次隐藏是键盘引起的」记账后收起，收起原因消失时才恢复——不能无条件
 * `setNavHidden(keyboardVisible)`：挂载时键盘不在场会把用户滚动收起的底栏顶回来。
 * 速记页此前用 `composerFocused || …` 在聚焦瞬间就收底栏，与待办页「等键盘信号」时序不同，
 * 正是「两页每次测试效果都独立」的一条来源；统一到键盘信号驱动（TG 口径：聚焦到键盘出现
 * 之间一切原地不动）。
 *
 * **native 一律不收**（mobile-keyboard R7，design §1.3）：overlay 模型下键盘盖在页面上、底栏本来就在
 * 键盘背后，收它只产生一段 200ms 的高度 / 布局动画，恰好挤在输入条位移的首帧——重列表（待办）
 * 就卡一下。`navOffsetPx` 的 `!keyboardVisible` 守卫仍让输入条压在键盘上沿、不留缝。web / PWA
 * 保留：iOS Safari 会滚文档、底栏会露到键盘上方。
 */
export function useKeyboardNavCollapse(): void {
  const keyboardVisible = useKeyboardVisible();
  const { setHidden } = useBottomNav();
  const causedRef = useRef(false);
  const collapseEnabled = Capacitor.getPlatform() === "web";
  useEffect(() => {
    if (!collapseEnabled) return;
    if (keyboardVisible) {
      causedRef.current = true;
      setHidden(true);
      return;
    }
    if (!causedRef.current) return;
    causedRef.current = false;
    setHidden(false);
  }, [collapseEnabled, keyboardVisible, setHidden]);
}

export interface KeyboardDockProps extends HTMLAttributes<HTMLElement> {
  /** 渲染成什么元素：速记 / 待办 composer 是 form，多选操作栏是 div。 */
  as?: "div" | "form";
  /** 下滑收起：整体 translateY(100%) 滑出视口（滚动隐藏协议，Todo composer 用）。 */
  hiddenByScroll?: boolean;
  /** 外部要拿驻坞元素本体（高度测量 / 自增高联动）时的 ref，与内部 glide ref 合流。 */
  dockRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}

/**
 * 底部固定条的统一驻坞壳（TG 结构对齐：全应用只有一份输入条定位实现，见
 * docs/notes/keyboard-pipeline-saga.md §二/§三——「发动机统一而车身两套」正是两页时序
 * 各自漂移的结构性根源）。速记 composer / 待办 composer / 待办多选栏全部由它定位，
 * 页面只提供内容；抬升口径、运动曲线、导航让位守卫改一处即三处同变。
 *
 * 职责（全部集中在此，页面不许自算）：
 * - fixed 定位 + 安全区组成式（bottom 只装 var(--safe-bottom)，恒定不动；env() 失效环境由
 *   兜底类 [bottom:var(--bottom-offset)] 落回 0px——见 invariants 第 11/12 条）。
 * - 抬升 = navOffset + 键盘高，走 transform 吃 .td-kbd-motion 过渡；**时长与曲线由
 *   useKeyboardMotion 给**（浮层 override > 实测的系统时长 did − will > 平台默认，见
 *   lib/keyboard/keyboardMotionPrefs.ts）：在场用 showMs、不在场用 hideMs，两端与 IME 同段滑动。
 *   navOffset 带 !keyboardVisible 守卫：键盘在场时底栏不占避让空间（防首帧 49px 双计）。
 * - 根元素带 data-kbd-dock：探针（KeyboardProbe）据此捕获 transitionstart/end 量输入条动画时刻。
 * - 壳缩量抹平（useShellResizeGlide）与 zIndex（backdrop=40，与 toast 带的关系见
 *   TodoSelectionBar 的层级注释）。
 */
export function KeyboardDock({
  as = "div",
  hiddenByScroll = false,
  dockRef,
  className = "",
  style,
  children,
  ...rest
}: KeyboardDockProps) {
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = useKeyboardVisible();
  const motion = useKeyboardMotion();
  const wide = useIsWideScreen();
  const { hidden: navHidden } = useBottomNav();
  const navOffsetPx = !wide && !navHidden && !keyboardVisible ? BOTTOM_NAV_HEIGHT_PX : 0;
  const liftPx = Math.ceil(navOffsetPx + keyboardHeight);

  const glideRef = useRef<HTMLElement | null>(null);
  useShellResizeGlide(glideRef, motion.showMs, motion.easing);
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      glideRef.current = el;
      dockRef?.(el);
    },
    [dockRef],
  );

  const El = as;
  return (
    <El
      ref={setRef}
      data-kbd-dock="1"
      className={`td-kbd-motion fixed left-0 right-0 [bottom:var(--bottom-offset)] ${className}`}
      style={
        {
          "--bottom-offset": "0px",
          bottom: "calc(0px + var(--safe-bottom))",
          transform: hiddenByScroll ? "translateY(100%)" : `translateY(${-liftPx}px)`,
          transitionDuration: `${keyboardVisible ? motion.showMs : motion.hideMs}ms`,
          transitionTimingFunction: motion.easing,
          zIndex: Z.backdrop,
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </El>
  );
}
