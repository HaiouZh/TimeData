import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { readViewportBottomGap, useKeyboardHeight, useKeyboardVisible } from "../hooks/useKeyboardHeight.ts";

// 聚焦框下方「取消/保存」按钮行的预留（EntryForm 按钮 py-3 + gap-3 + pb-4 约 76px，取整留余）。
const SCROLL_EXTRA_PX = 96;

function hasFixedAncestor(el: HTMLElement): boolean {
  for (let node = el.parentElement; node instanceof HTMLElement; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return true;
  }
  return false;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node instanceof HTMLElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/** 此刻「键盘上沿」的视口 y：显式差值滚动的底线。 */
function readVisualBottom(keyboardHeightFallback: number): number {
  const vv = window.visualViewport;
  const innerHeight = window.innerHeight;
  if (!vv) return innerHeight - keyboardHeightFallback;
  // iOS resize:none 下 WebKit 可能既不缩视口也不更新 visualViewport（useKeyboardHeight 同款口径）：
  // vv 报得出遮挡就用它的底，报不出回落插件高度。iOS 的 innerHeight 不随键盘变，回落不会混到 stale 视口高。
  if (Capacitor.getPlatform() === "ios") {
    return readViewportBottomGap() > 0 ? vv.offsetTop + vv.height : innerHeight - keyboardHeightFallback;
  }
  // Android / web：vv 是实时权威值。壳缩 WebView 的瞬间 resize 事件先到、React 提交在后，
  // 若在此回落 state 里的键盘高，会把底线压低一个键盘高（多滚一截且只补不回滚），故恒信 vv。
  return vv.offsetTop + vv.height;
}

function revealFocusedInput(keyboardHeightFallback: number): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!active.matches("input, textarea, [contenteditable]")) return;
  // fixed 输入条（速记/待办 composer）与 fixed 弹层有自己的 bottom 避让，滚文档流对它们无意义。
  if (hasFixedAncestor(active)) return;
  const scroller = findScrollableAncestor(active);
  if (!scroller) return;
  // 只补不足、绝不回滚：重复触发幂等（滚过之后 rect.bottom 已上移、deficit 归零），键盘动画中间值 /
  // 拼音候选条加高只会朝「还不够」的方向继续补。滚动空间由 .keyboard-scroll-pad 的 padding 制造
  //（短表单整页放得下时滚动容器原本无溢出，scrollTop 被 clamp 在 0，没这刀 padding 本函数同样 no-op）。
  const deficit =
    active.getBoundingClientRect().bottom + SCROLL_EXTRA_PX - readVisualBottom(keyboardHeightFallback);
  if (deficit > 0) scroller.scrollTop += deficit;
}

/**
 * 把键盘遮挡量（useKeyboardHeight，「键盘还挡着多少、JS 还要让开多少」，壳已让位时恒 0）
 * 桥进全局，服务**没有 fixed 输入条那套 JS 避让**的文档流表单（EntryPage / 日记 / Sheet）：
 *
 * - `--keyboard-inset`：纯遮挡量。日记页容器让高、Sheet 压 max-height 直接消费，
 *   不必每处各自跑一份 useKeyboardHeight 的监听。
 * - `--keyboard-scroll-padding`：遮挡量 + 保存按钮预留，由 `.keyboard-scroll-pad`（EntryForm 根
 *   容器一类）当 padding-bottom 消费--给滚动容器制造真实可滚的量，短表单（整页放得下、原本无
 *   溢出）的显式滚动才有得滚。
 * - 聚焦滚动**不委托引擎**，JS 显式算差值（rect.bottom + 96 - 键盘上沿，只补不足不回滚）：
 *   `scrollIntoView({block:"nearest"})` 在 iOS resize:none 下对已在布局视口内的框判「可见」直接
 *   no-op（备注框被键盘整个盖住），CSS scroll-padding 又会在安卓壳让位的窗口期把过期键盘量喂给
 *   Blink 原生聚焦滚动、叠成双倍让位（真机「滑太高」）。底线实时读 visualViewport：iOS 报不出
 *   遮挡时回落插件高度，Android/web 恒信 vv。触发两路：遮挡量每变一次（iOS 主路径，含动画中间
 *   值 / 候选条加高的正->正补足）+ 键盘在场边沿与在场期间的 window/visualViewport resize（Android
 *   主路径：壳让位后遮挡量恒 0、高度永不变化，只有事件知道该动了）。fixed 输入条（速记/待办
 *   composer）里的焦点无害：固定定位的避让走各页自己的 bottom 合成，这里对 fixed 祖先内的
 *   元素直接跳过。
 * - 键盘「在场->不在场」的那一跳把仍持焦点的输入元素 blur 掉（见下方 effect 的注释）。
 *
 * 桌面浏览器上键盘高恒 0 且不在场：变量不落地、滚动不触发，本组件整体自动歇业。
 */
export function KeyboardAvoidanceBridge() {
  const keyboardHeight = useKeyboardHeight();
  // 收焦点用「在不在场」而非遮挡量：安卓壳让位后遮挡量恒 0，用它判不出键盘落没落。
  const keyboardVisible = useKeyboardVisible();
  // resize 监听里不能读 state（壳缩 WebView 瞬间事件先于 React 提交，读到的是旧值），render 期镜像最新高度。
  const latestHeightRef = useRef(0);
  latestHeightRef.current = keyboardHeight;

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    if (keyboardHeight > 0) {
      rootStyle.setProperty("--keyboard-inset", `${keyboardHeight}px`);
      rootStyle.setProperty("--keyboard-scroll-padding", `${keyboardHeight + SCROLL_EXTRA_PX}px`);
    } else {
      rootStyle.removeProperty("--keyboard-inset");
      rootStyle.removeProperty("--keyboard-scroll-padding");
    }
    // 卸载时清残留（键盘还弹着时组件树被卸的场景），与「收起时移除」同一出口。
    return () => {
      rootStyle.removeProperty("--keyboard-inset");
      rootStyle.removeProperty("--keyboard-scroll-padding");
    };
  }, [keyboardHeight]);

  // iOS 主路径：遮挡量每变一次补一次（含正->正：键盘动画中间值、拼音候选条加高）。
  useEffect(() => {
    if (keyboardHeight <= 0) return;
    revealFocusedInput(keyboardHeight);
  }, [keyboardHeight]);

  // Android 主路径：壳让位后遮挡量恒 0、高度永不变化，靠「在场边沿 + 在场期间 resize」驱动
  //（壳缩 WebView 触发 resize，按实时 vv 补出按钮行余量；差值幂等，重复跑无害）。
  useEffect(() => {
    if (!keyboardVisible) return;
    const run = () => revealFocusedInput(latestHeightRef.current);
    run();
    window.addEventListener("resize", run);
    window.visualViewport?.addEventListener("resize", run);
    return () => {
      window.removeEventListener("resize", run);
      window.visualViewport?.removeEventListener("resize", run);
    };
  }, [keyboardVisible]);

  // 键盘落下的那一跳收掉焦点。iOS 上用**输入法自带的收起键**收键盘只收键盘、不摘网页焦点：
  // 输入框仍是 document.activeElement，WKWebView 的内容视图仍是 first responder--此后碰屏上
  // 任何东西（任务行、顶栏、tab）WebKit 都会把键盘重新弹回来（真机实测「点什么都会先弹一次」）。
  // 切 tab 那一下最刺眼：键盘弹起 -> 导航把上一层打成 inert（KeptRouteStack，iOS 专用）-> 规范要求
  // blur 掉层内焦点元素 -> 键盘立刻又落下 -> 目标页 React.lazy 的 chunk 加载完才换屏，观感是
  // 「先把输入法唤起收起走一遍，才切换」。收起时主动 blur 即掐掉这条链的源头。
  //
  // 只认「在场->不在场」那一跳，不写成「不在场就 blur」：桌面浏览器 keyboardVisible 恒 false，
  // 后者会在 Bridge **挂载那一跑**把光标从用户正敲着的输入框里踢出去（恒 false 时依赖不变、
  // effect 不重跑，故只有挂载那次会走到；钉这条的是「挂载时不碰已聚焦输入框」那个用例）。
  // 只收可输入元素：焦点停在按钮上时 blur 掉会白丢键盘用户的焦点环。
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const prev = prevVisibleRef.current;
    prevVisibleRef.current = keyboardVisible;
    if (keyboardVisible || !prev) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.matches("input, textarea, [contenteditable]")) return;
    active.blur();
  }, [keyboardVisible]);

  return null;
}
