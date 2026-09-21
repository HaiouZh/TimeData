import { composeBottomInset } from "../lib/bottomInset.js";
import { useKeyboardHeight, useKeyboardHeightSettled, useKeyboardVisible } from "./useKeyboardHeight.js";

export interface BottomInsetInput {
  /** 键盘不在场时底部占位条的高度（页面私有的「底部站着谁」判断的结果）。 */
  barPx: number;
  /** 键盘在场时的占位条高度；缺省 = barPx。Todo：被滚动藏起的 composer 在键盘在场时不算隐藏。 */
  barPxWhileKeyboard?: number;
  /** 底栏在文档流里时的占位（`!wide && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0`）；键盘在场时归零由本 hook 做。 */
  navOffsetBasePx: number;
}

export interface BottomInset {
  /** 跟着输入条走的量（贴 composer 的浮层、Dock）。 */
  immediatePx: number;
  /** 键盘动画结束后才变的量（内容留白、sticky）：nav 守卫与键盘高都按 settled 判，动画期零布局。 */
  settledPx: number;
  keyboardVisible: boolean;
}

/**
 * 底部避让量的**唯一消费入口**（mobile-keyboard R8，design §3.1）：只有真正落到 DOM 的叶子组件调它，
 * 页面根不再订阅键盘——页面每次键盘事件整页重渲染（~200ms 主线程）正是「输入条不跟手」的主因。
 * 合成口径原样走 composeBottomInset（Math.ceil），`!keyboardVisible` 的 nav 守卫从两页搬进来。
 */
export function useBottomInset({ barPx, barPxWhileKeyboard = barPx, navOffsetBasePx }: BottomInsetInput): BottomInset {
  const height = useKeyboardHeight();
  const settledHeight = useKeyboardHeightSettled();
  const visible = useKeyboardVisible();
  // 壳已让位（height 恒 0 但在场）没有动画要护，settled 侧直接按在场算。
  const settledVisible = settledHeight > 0 || (visible && height === 0);
  return {
    immediatePx: composeBottomInset({
      barHeightPx: visible ? barPxWhileKeyboard : barPx,
      navOffsetPx: visible ? 0 : navOffsetBasePx,
      keyboardHeightPx: height,
    }),
    settledPx: composeBottomInset({
      barHeightPx: settledVisible ? barPxWhileKeyboard : barPx,
      navOffsetPx: settledVisible ? 0 : navOffsetBasePx,
      keyboardHeightPx: settledHeight,
    }),
    keyboardVisible: visible,
  };
}
