import { Capacitor } from "@capacitor/core";
import { type CSSProperties, type HTMLAttributes, type ReactNode, useCallback, useEffect, useRef } from "react";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useBottomInset } from "../hooks/useBottomInset.js";
import { useKeyboardMotion, useKeyboardVisible } from "../hooks/useKeyboardHeight.ts";
import { useShellResizeGlide } from "../lib/keyboardMotion.ts";
import { useIsWideScreen } from "../lib/useIsWideScreen.ts";
import { Z } from "../lib/zLayers.ts";

/**
 * 键盘引起的底栏实体收起（两页共用的唯一实现，原 TodoPage 私有 effect 提升而来）。
 *
 * 只把「这次隐藏是键盘引起的」记账后收起，收起原因消失时才恢复——不能无条件
 * `setNavHidden(keyboardVisible)`：挂载时键盘不在场会把用户滚动收起的底栏顶回来。
 * 底栏已因滚动 / 搜索藏着时不记账，收键盘不会把它顶回。
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
  const { hidden, setHidden } = useBottomNav();
  const causedRef = useRef(false);
  // 只读不订阅：记账那一刻底栏是不是已经因别的原因藏着（滚动 / 搜索），是就不记、收键盘时也不动它。
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const collapseEnabled = Capacitor.getPlatform() === "web";
  useEffect(() => {
    if (!collapseEnabled) return;
    if (keyboardVisible) {
      if (!hiddenRef.current) {
        causedRef.current = true;
        setHidden(true);
      }
      return;
    }
    if (!causedRef.current) return;
    causedRef.current = false;
    setHidden(false);
  }, [collapseEnabled, keyboardVisible, setHidden]);
}

/**
 * 不渲染任何东西的壳：useKeyboardNavCollapse 内部订阅 useKeyboardVisible，挂在哪个组件里哪个组件就
 * 跟着键盘重渲染——页面根必须用本组件而不是直接调 hook（mobile-keyboard R8 design §3.1）。
 *
 * 页面与其他组件一律渲染 `<KeyboardNavCollapse />`，不要直接调本 hook——调用方会跟着键盘重渲染。
 * hook 导出只为壳与测试。
 */
export function KeyboardNavCollapse() {
  useKeyboardNavCollapse();
  return null;
}

export interface KeyboardDockProps extends HTMLAttributes<HTMLElement> {
  /** 渲染成什么元素：速记 / 待办 composer 是 form，多选操作栏是 div。 */
  as?: "div" | "form";
  /** 滚动收起：`translateY(100%)` 滑出视口；**键盘在场时不生效**（原 TodoPage 的 `!keyboardVisible` 守卫下沉至此：键盘弹起会触发 web 的收底栏 effect，不守卫会把它误判成滚动收起、composer 滑进键盘后面）。 */
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
 *   useKeyboardMotion 给**（浮层 override > 平台默认（实测时长只记不用），见
 *   packages/client/src/lib/keyboard/keyboardMotionPrefs.ts）：在场用 showMs、不在场用 hideMs，两端与 IME 同段滑动。
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
  const motion = useKeyboardMotion();
  const wide = useIsWideScreen();
  const { hidden: navHidden } = useBottomNav();
  // 抬升量走 useBottomInset 的即时侧（bar 0：Dock 自己就是那条 bar）：nav 的 !keyboardVisible 守卫只此一份。
  const { immediatePx: liftPx, keyboardVisible } = useBottomInset({
    barPx: 0,
    navOffsetBasePx: !wide && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0,
  });
  const hidden = hiddenByScroll && !keyboardVisible;

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
          transform: hidden ? "translateY(100%)" : `translateY(${-liftPx}px)`,
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
