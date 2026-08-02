/**
 * 底部避让量单一合成来源：速记（QuickNotesPage）与待办（TodoPage）两页各自算出
 * 「此刻底部站着谁」（`barHeightPx`，各页私有逻辑，见两页各自的 `bottomInsetPx` /
 * `bottomBarHeightPx`）与底部导航占位（`navOffsetPx`），本函数只负责把它们与键盘高
 * （`keyboardHeightPx`，见 `useKeyboardHeight`）合成为一个基础量（px，不含 safe-area）。
 *
 * **回归护栏**：`keyboardHeightPx = 0` 时结果必须与合成前逐值相等——桌面浏览器
 * / 无键盘场景键盘高恒为 0，任何偏差都是回归（见 bottomInset.test.ts 的显式断言）。
 *
 * `Math.ceil` 与 Todo 页原 `composerAvoidancePx = Math.ceil(...)` 口径一致，此前逐处
 * 是整数和时 ceil 不改变结果。
 *
 * 纯函数、不碰 db / DOM，故自动落 node 快桶（判定见 `packages/client/test-buckets.mjs`）。
 */
export function composeBottomInset(parts: {
  barHeightPx: number;
  navOffsetPx: number;
  keyboardHeightPx: number;
}): number {
  return Math.ceil(parts.barHeightPx + parts.navOffsetPx + parts.keyboardHeightPx);
}
