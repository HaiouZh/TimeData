/**
 * 底部避让量单一合成来源：速记（QuickNotesPage）与待办（TodoPage）两页各自算出
 * 「此刻底部站着谁」（`barHeightPx`，各页私有逻辑，见两页各自的 `bottomInsetPx` /
 * `bottomBarHeightPx`）与底部导航占位（`navOffsetPx`），本函数只负责把它们与键盘遮挡量
 * （`keyboardHeightPx`，见 `useKeyboardHeight`——是「键盘还挡着多少、JS 还要让开多少」，
 * 壳自己让过位时为 0，不是键盘自身高度）合成为一个基础量（px，不含 safe-area）。
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

/**
 * **文档流容器**的键盘让位（上面那个是 fixed 侧的加法合成，这个是文档流侧的减法，两者互补）。
 *
 * `keyboardHeightPx` 的语义是「键盘从**屏幕底**往上挡了多少」，只对底边贴着屏幕底的元素直接成立
 * （fixed 的驻坞条、`inset-0` 的弹层 overlay）。文档流容器不一样：底部导航是 flex 兄弟、实打实占
 * `navOffsetPx + safe-bottom` 的布局高度，容器底边离屏幕底本来就有这么一段，键盘真正压到容器的只是
 * 重叠的那部分。照搬遮挡量就会多让一个底栏高——内容底边停在键盘上沿之上，中间露出容器自己的底色
 * （日记页真机表现即「输入法上方一行黑条」，2026-09-21 复现：黑条 49px = BOTTOM_NAV_HEIGHT_PX）。
 *
 * 返回 CSS 长度串而不是 px 数：底栏总高 = `navOffsetPx + var(--safe-bottom)`，安全区那一项只有 CSS
 * 算得出（组成式接口见 index.css，`--safe-bottom` 现为 0px 但消费点一律不写死，invariants 11）。
 * `max(0px, …)` 兜住「键盘比底栏还矮」的中间值（动画帧 / 分屏小键盘），不让负 padding 漏出去。
 * `navOffsetPx = 0`（宽屏 / 底栏已隐）时容器底边就是屏幕底，退回原样让整个遮挡量。
 * `Math.ceil` 与 `composeBottomInset` 同口径。
 */
export function composeFlowKeyboardInset(parts: { keyboardHeightPx: number; navOffsetPx: number }): string {
  // 键盘不在场（桌面浏览器 / 收起 / 安卓壳已让位）恒零让位：不留 calc 包装，与引入本函数前逐值相等。
  if (parts.keyboardHeightPx <= 0) return "0px";
  const keyboardPx = Math.ceil(parts.keyboardHeightPx);
  if (parts.navOffsetPx <= 0) return `${keyboardPx}px`;
  return `max(0px, calc(${keyboardPx}px - ${parts.navOffsetPx}px - var(--safe-bottom)))`;
}
