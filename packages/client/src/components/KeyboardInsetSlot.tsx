import type { ReactNode } from "react";
import { type BottomInsetInput, useBottomInset } from "../hooks/useBottomInset.js";

export interface KeyboardInsetSlotProps {
  inset: BottomInsetInput;
  /** true = 吃 settled 值（sticky 一类布局量）；默认即时值（贴 composer 的浮层）。 */
  settled?: boolean;
  children: (px: number) => ReactNode;
}

/**
 * 把避让量交给一个小渲染函数（浮层 / sticky 按钮）：只有这个函数的输出随键盘重渲染，
 * 页面根不订阅键盘（mobile-keyboard R8 design §3.1）。
 */
export function KeyboardInsetSlot({ inset, settled = false, children }: KeyboardInsetSlotProps) {
  const { immediatePx, settledPx } = useBottomInset(inset);
  return <>{children(settled ? settledPx : immediatePx)}</>;
}
