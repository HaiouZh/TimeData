import { useEffect, useRef } from "react";
import { useKeyboardHeight, useKeyboardVisible } from "../hooks/useKeyboardHeight.ts";

// scroll-padding 里给聚焦框**下方**留的余量：聚焦备注类输入框时，把它滚到键盘上方还不够，
// 用户还要看得见紧随其后的「保存」按钮行（EntryForm 的按钮 py-3 + gap-3 + pb-4 约 76px）。
const SCROLL_EXTRA_PX = 96;

/**
 * 把键盘遮挡量（useKeyboardHeight，「键盘还挡着多少、JS 还要让开多少」，壳已让位时恒 0）
 * 桥进全局，服务**没有 fixed 输入条那套 JS 避让**的文档流表单（EntryPage / 日记 / Sheet）：
 *
 * - `--keyboard-inset`：纯遮挡量。日记页容器让高、Sheet 压 max-height 直接消费，
 *   不必每处各自跑一份 useKeyboardHeight 的监听。
 * - `--keyboard-scroll-padding`：遮挡量 + 保存按钮预留，给滚动容器当 scroll-padding-bottom
 *   （见 index.css 的 .app-main）——只影响聚焦滚动的落点，不改布局，与页内既有避让不叠加。
 * - 键盘 0→正 的那一跳把聚焦的文档流输入元素 scrollIntoView 进「键盘上方」可视区：
 *   iOS resize:none 下 WebKit 不会替我们滚（body 不滚、内层 main 滚的结构里它常年失灵）。
 *   fixed 输入条（速记/待办 composer）里的焦点无害：fixed 不在滚动流里，浏览器视其已可见、no-op。
 * - 键盘「在场→不在场」的那一跳把仍持焦点的输入元素 blur 掉（见下方 effect 的注释）。
 *
 * 安卓（壳层 adjustResize + ime inset 让位后）与桌面浏览器上键盘高恒 0：变量不落地、滚动不触发，
 * 本组件整体自动歇业——不产生任何双算。
 */
export function KeyboardAvoidanceBridge() {
  const keyboardHeight = useKeyboardHeight();
  // 收焦点用「在不在场」而非遮挡量：安卓壳让位后遮挡量恒 0，用它判不出键盘落没落。
  const keyboardVisible = useKeyboardVisible();

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

  // 只在 0→正 的第一跳滚一次：正值间的微调是 visualViewport 抖动 / 键盘换布局，跟着重滚会晃视口。
  const prevHeightRef = useRef(0);
  useEffect(() => {
    const prev = prevHeightRef.current;
    prevHeightRef.current = keyboardHeight;
    if (keyboardHeight <= 0 || prev > 0) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.matches("input, textarea, [contenteditable]")) return;
    // scroll-padding 变量由上一个 effect 同步写入（同组件内声明序先跑），此刻滚动落点已含键盘让位。
    if (typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [keyboardHeight]);

  // 键盘落下的那一跳收掉焦点。iOS 上用**输入法自带的收起键**收键盘只收键盘、不摘网页焦点：
  // 输入框仍是 document.activeElement，WKWebView 的内容视图仍是 first responder——此后碰屏上
  // 任何东西（任务行、顶栏、tab）WebKit 都会把键盘重新弹回来（真机实测「点什么都会先弹一次」）。
  // 切 tab 那一下最刺眼：键盘弹起 → 导航把上一层打成 inert（KeptRouteStack，iOS 专用）→ 规范要求
  // blur 掉层内焦点元素 → 键盘立刻又落下 → 目标页 React.lazy 的 chunk 加载完才换屏，观感是
  // 「先把输入法唤起收起走一遍，才切换」。收起时主动 blur 即掐掉这条链的源头。
  //
  // 只认「在场→不在场」那一跳，不写成「不在场就 blur」：桌面浏览器 keyboardVisible 恒 false，
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
