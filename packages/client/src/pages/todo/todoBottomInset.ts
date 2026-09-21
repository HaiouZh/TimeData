import type { BottomInsetInput } from "../../hooks/useBottomInset.js";

export interface TodoBottomInsetArgs {
  selectionMode: boolean;
  composerHeightPx: number;
  /** 滚动收起要求 composer 藏起（页面只说「要它藏」；键盘在场时不算隐藏由 useBottomInset 的 barPxWhileKeyboard 兜）。 */
  composerScrollHidden: boolean;
  navOffsetBasePx: number;
  selectionBarHeightPx: number;
}

/**
 * 待办页「此刻底部站着谁」→ useBottomInset 的输入。多选态站着的是操作栏（滚动藏不了它）；
 * 非多选态被滚动藏起的 composer 键盘在场时不算隐藏（barPxWhileKeyboard）。纯函数，闸在 todoBottomInset.test.ts。
 */
export function todoBottomInset({
  selectionMode,
  composerHeightPx,
  composerScrollHidden,
  navOffsetBasePx,
  selectionBarHeightPx,
}: TodoBottomInsetArgs): BottomInsetInput {
  if (selectionMode) return { barPx: Math.max(composerHeightPx, selectionBarHeightPx), navOffsetBasePx };
  return { barPx: composerScrollHidden ? 0 : composerHeightPx, barPxWhileKeyboard: composerHeightPx, navOffsetBasePx };
}
