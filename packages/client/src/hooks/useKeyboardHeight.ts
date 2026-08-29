import { Capacitor } from "@capacitor/core";
import { Keyboard, type KeyboardInfo } from "@capacitor/keyboard";
import { useSyncExternalStore } from "react";

// 地址栏收合等无关抖动也会让 visualViewport 与 innerHeight 出现小差值；只有差值超过这个阈值
// 才当作键盘遮挡，避免误报。
const KEYBOARD_BOTTOM_GAP_THRESHOLD_PX = 80;

function readInnerHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches("input, textarea, [contenteditable]");
}

/**
 * 实测「布局视口底部被遮住多少」——正是 `position: fixed; bottom: 0` 的元素要额外抬起的量。
 * 壳无论用哪种方式让位（缩 webview / 整体上移视口 / 什么都不做），这个差值都如实反映剩余遮挡。
 */
export function readViewportBottomGap(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  const innerHeight = readInnerHeight();
  if (!viewport || innerHeight <= 0) return 0;

  const bottomGap = innerHeight - viewport.height - viewport.offsetTop;
  return bottomGap > KEYBOARD_BOTTOM_GAP_THRESHOLD_PX ? bottomGap : 0;
}

type KeyboardState = { height: number; visible: boolean };

/**
 * 键盘状态的**单一信源**：一处监听、一份状态、所有消费方订阅同一份。
 *
 * 为什么必须是单例：每个消费方各挂一整套监听时，「键盘不在场时的 innerHeight」这条基线各算各的，
 * 而**键盘已经弹起之后才挂载**的那个消费方会把被壳压缩过的高度当成基线——它算出的 shellShrink
 * 恒为 0、报出的遮挡量比先挂载的那个多一整段，两个固定在底部的条一个停在键盘上沿、另一个飞在半空；
 * visible 侧同理，晚挂载者初值 false 而键盘正弹着，要等下一次事件才对得上，而那次事件可能不来。
 * 切页面、展开带输入条的面板都会造出这种晚挂载。Telegram 的「单一信源、自上而下下发」正是对着这个。
 *
 * height 与 visible 两侧的内部状态**刻意各留一份**：两条基线的校准条件本就不同
 *（visible 侧按「缩量 ≤ 阈值」校准，height 侧按「插件报的键盘高度 ≤ 0」校准），合并会改语义。
 * 共享的只是那套 DOM / 插件监听与订阅分发。
 */
let state: KeyboardState = { height: 0, visible: false };
const subscribers = new Set<() => void>();
let stopListening: (() => void) | null = null;

function publish(next: Partial<KeyboardState>): void {
  const merged = { ...state, ...next };
  // 值没变就不通知：useSyncExternalStore 按快照身份判定，无谓的新值会招来多余重渲染。
  if (merged.height === state.height && merged.visible === state.visible) return;
  state = merged;
  for (const notify of [...subscribers]) notify();
}

function startListening(): () => void {
  if (typeof window === "undefined") return () => {};

  const webPlatform = Capacitor.getPlatform() === "web";
  const nativePlatform = !webPlatform;

  // ── visible 侧内部状态 ──────────────────────────────────────────────
  // 壳还没让位时的 innerHeight 基线。壳缩 webview 的设备上，缩量与 IME 动画同步，
  // 是最早的在场信号；壳不动的设备（overlay 模型，本仓当前配置）此分支恒不触发。
  let visibleBaseline = readInnerHeight();
  // keyboardWillHide / focusout 之后压住缩量路径，直到壳真的把 webview 恢复回来。事件先到、
  // 壳 reflow 在后，恢复途中的中间帧缩量仍超阈值，不压就会把刚落下的在场状态一路顶回 true。
  // 按缩量解除、不猜动画时长——壳分几帧恢复都不影响判定。
  let shrinkSuppressed = false;

  // ── height 侧内部状态 ──────────────────────────────────────────────
  // 键盘收起时的 innerHeight。壳缩 webview 时 innerHeight 会变小，差值就是壳已经让掉的量。
  let heightBaseline = readInnerHeight();
  let rawKeyboardPx = 0;

  const recomputeVisible = () => {
    // 实测路径只在「没有插件事件可依赖」时说了算——native 上它会在壳让位后恒 0，
    // 不能让它把事件置起的 true 冲掉，故只升不降由事件层决定：web 平台事件层缺席，
    // 实测是唯一信源，双向都归它。
    if (webPlatform) {
      publish({ visible: readViewportBottomGap() > 0 });
      return;
    }
    const shrinkPx = visibleBaseline - readInnerHeight();
    if (shrinkPx <= KEYBOARD_BOTTOM_GAP_THRESHOLD_PX) {
      // 壳没让位（或已恢复）：此刻的 innerHeight 才是真基线，顺手校准；压制随之解除。
      shrinkSuppressed = false;
      visibleBaseline = readInnerHeight();
      return;
    }
    if (shrinkSuppressed) return;
    // native 提前量：**只升不降**，落回仍归 keyboardWillHide 管。
    publish({ visible: true });
  };

  const recomputeHeight = () => {
    // web：实测是唯一信源（无插件桥接，rawKeyboardPx 恒 0）。
    if (webPlatform) {
      publish({ height: readViewportBottomGap() });
      return;
    }

    if (rawKeyboardPx <= 0) {
      // 键盘不在场：此刻 innerHeight 就是没有键盘时的真实值，顺手刷新基线
      //（壳缩过 webview 的话，它恢复全高时会再触发一次 resize，基线随之回到全高）。
      heightBaseline = readInnerHeight();
      publish({ height: 0 });
      return;
    }

    // 键盘在场：插件高度减去壳已让掉的量。壳不动（overlay，本仓配置）时 shrink 恒 0、
    // 全额生效；壳缩了的设备逐次 resize 跟随，不留跨次记忆（记忆值曾是「飞半空」的温床）。
    const shellShrinkPx = Math.max(0, heightBaseline - readInnerHeight());
    // 引擎 reveal-pan 几何校正（不是第二个键盘尺寸信源）：index.html 的
    // interactive-widget=overlays-content 已叫 Chromium 不平移视口；不认该参数的 WebView 仍会
    // 为露出聚焦框把视觉视口上移 offsetTop——fixed 元素随之被视觉抬走同量，JS 再抬全额就叠成
    // 「输入框飞到屏幕中间、tab 栏也上移」（2026-08-23 真机）。把平移量扣掉，引擎收手时恢复全额。
    const pannedPx = Math.max(0, Math.round(window.visualViewport?.offsetTop ?? 0));
    publish({ height: Math.max(0, rawKeyboardPx - shellShrinkPx - pannedPx) });
  };

  const handleViewportChange = () => {
    recomputeVisible();
    recomputeHeight();
  };

  const viewport = window.visualViewport;
  window.addEventListener("resize", handleViewportChange);
  viewport?.addEventListener("resize", handleViewportChange);
  viewport?.addEventListener("scroll", handleViewportChange);

  // focusout 到非可编辑目标即离场（换输入框不闪落）：插件事件缺席 / 外接键盘时的自愈出口。
  // 刻意**没有** focusin 对称分支——TG 双端都不做预测性在场，聚焦一律等真实键盘信号
  //（预测会让消费方先动一段再被校正，真机观感即「卡顿 / 上蹿下跳找位置」）。
  const handleFocusOut = (event: FocusEvent) => {
    if (!isEditableTarget(event.target)) return;
    if (isEditableTarget(event.relatedTarget)) return;
    // 与 keyboardWillHide 同款竞态：离场先到、壳恢复 webview 在后，恢复途中的中间帧缩量
    // 仍超阈值，不压会被「只升不降」分支顶回 true。按缩量解除（recomputeVisible 里），
    // 不猜动画时长。
    shrinkSuppressed = true;
    publish({ visible: false });
    rawKeyboardPx = 0;
    recomputeHeight();
  };
  if (nativePlatform) {
    window.addEventListener("focusout", handleFocusOut);
  }

  let removeNative = () => {};
  if (nativePlatform) {
    try {
      // 插件缺席时 addListener **不是同步抛**而是返回 rejected promise（web 桥 UNIMPLEMENTED /
      // native 壳未注册同理），外层 try/catch 逮不住——必须在返回处同步 .catch 接住，否则是
      // unhandled rejection（AppShell 挂 KeyboardAvoidanceBridge 后，凡 mock 平台为 native 又
      // 没 mock 插件的测试整文件炸掉，App.keptStack.test.tsx 曾如此）。接住后静默降级。
      const showListener = Keyboard.addListener("keyboardWillShow", (info: KeyboardInfo) => {
        shrinkSuppressed = false;
        publish({ visible: true });
        rawKeyboardPx = Number.isFinite(info?.keyboardHeight) ? info.keyboardHeight : 0;
        recomputeHeight();
      }).catch(() => null);
      const hideListener = Keyboard.addListener("keyboardWillHide", () => {
        shrinkSuppressed = true;
        publish({ visible: false });
        rawKeyboardPx = 0;
        recomputeHeight();
      }).catch(() => null);
      removeNative = () => {
        void showListener.then((handle) => handle?.remove()).catch(() => {});
        void hideListener.then((handle) => handle?.remove()).catch(() => {});
      };
    } catch {
      // addListener 同步抛（旧桥 shim / 插件对象缺失）：native 无信源，高度恒 0——
      // 宁可不抬也不引入实测与事件的双源竞态（recomputeVisible 的实测分支只认 web）。
    }
  }

  handleViewportChange();

  return () => {
    window.removeEventListener("resize", handleViewportChange);
    viewport?.removeEventListener("resize", handleViewportChange);
    viewport?.removeEventListener("scroll", handleViewportChange);
    if (nativePlatform) {
      window.removeEventListener("focusout", handleFocusOut);
    }
    removeNative();
    // 最后一个消费方走了：状态复位，下次挂载重新从「键盘不在场」起步并重取基线。
    state = { height: 0, visible: false };
  };
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  if (subscribers.size === 1) stopListening = startListening();
  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

/**
 * 键盘**在不在场**，与 useKeyboardHeight 的「还挡着多少」刻意解耦：壳层让过位时遮挡量恒 0——
 * 那是「JS 无需再让位」，不等于「键盘没弹」。「键盘弹起时收起底栏」「composer 不算滚动隐藏」
 * 这类在场判断必须用本信号。
 *
 * 口径（TG 单源模型，2026-08-22 真机读数钉死）：native 平台由插件事件驱动——安卓 willShow 在
 * IME inset 动画 onStart 即发、iOS 走 UIKit 通知，都是「动画开始那一刻」的信号，不需要预测；
 * 壳缩 webview 的设备另有缩量兜底（缩量与 IME 动画同步，比插件事件还早半拍）。web / PWA 无插件
 * 桥接，用实测遮挡兜底。focusout 到非可编辑目标即离场：这是插件事件缺席 / 外接键盘（willShow
 * 永不来）时把在场信号收回来的唯一自愈出口。
 */
export function useKeyboardVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.visible,
    () => false,
  );
}

/**
 * 键盘挡住页面底部多少（px）——**不是**键盘自身的高度，而是「JS 还需要额外让开多少」。
 * 键盘收起、或壳已经自己让过位时都是 0。
 *
 * TG 单源模型（对抗验证 + 2026-08-22 真机读数后重写，报告见 .dispatch/20260822-kbd-statemachine
 * 与 20260822-tg-reference）：
 *
 * - **native 只听插件事件**。安卓 willShow 在 IME inset 动画 onStart 即发、带最终高度（CSS px，
 *   插件源码 imeHeight/density）；iOS 走 UIKit WillShow/WillHide 通知。事件到达即起步，输入条的
 *   `.td-kbd-motion` 过渡（250ms，TG DEFAULT_INTERPOLATOR 同参）与 IME 动画同向同段滑动。
 *   Telegram 双端同款：不预测（focusin 不预抬——预测值与校正值的两段运动就是「唤起卡顿」）、
 *   不拿 visualViewport 实测与事件互相校正（多源竞态正是「飞半空 / 收起悬空」的温床）。
 * - **壳缩量兜底**：壳真的缩了 webview 的设备（本仓配置下不该发生，OEM 兜底），按
 *   「基线 - 当前 innerHeight」把壳已让掉的量从插件高度里扣除；基线只在键盘不在场时校准。
 * - **web / PWA 无插件桥接**：visualViewport 实测是唯一信源，行为与历史版本一字不差。
 * - focusout 到非可编辑目标把高度清零：插件 willHide 丢失时的自愈出口（TG 之外的 webview 现实）。
 */
export function useKeyboardHeight(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.height,
    () => 0,
  );
}
