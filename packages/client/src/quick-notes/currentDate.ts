export interface StuckCandidate {
  top: number;
  height: number;
}

/**
 * 找出正粘在滚动容器顶部的那条日期条。判据同 Telegram Web-A 的 findStuckDate：
 * 元素顶边相对可视区顶部的距离落在 [-自身高度, stickyTop] 之间——上界表示它已经
 * 到达（或越过）粘住位置，下界表示它还没被下一条完全顶出视口。
 *
 * 用 getBoundingClientRect 算出的 top 而不是 offsetTop：粘住时 rect.top 精确等于
 * stickyTop（这是 position:sticky 的定义），判据无需依赖 offsetParent 与滚动容器
 * 同参考系这个隐含前提。
 *
 * 多条同时落在区间时返回第一条——它正被下一条顶出、此刻仍占着顶部那块像素。
 *
 * 这条「取第一条」依赖一个 **DOM 前提：每天各自成一个 sticky 包含块**（页面层按天包一层 div，
 * 见 `dayGroups.ts`）。只有这样「上一条被下一条顶出」才真的会发生，区间里同时出现两条才等价于
 * 「前一条正在退场」。若把日期条与气泡拍平成同一父级的兄弟，sticky 兄弟互不推挤，窗口里滚过的
 * 每一条 top 都恒等于 stickyTop、全部落进区间，这里就会返回最早那天——语义直接反掉。
 */
export function findStuckDivider<T extends StuckCandidate>(dividers: T[], stickyTop: number): T | null {
  for (const divider of dividers) {
    if (divider.top >= -divider.height && divider.top <= stickyTop) return divider;
  }
  return null;
}
