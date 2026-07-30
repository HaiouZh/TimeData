/**
 * 用户内容身份色的取色内核：项目与标签同源取色（见 [ADR 0026](../../../../docs/adr/0026-content-tint-shared-palette-shape-distinguishes-type.md)）。
 *
 * 返回 `var(--color-tint-N)` 而非 Tailwind 类名——Tailwind v4 扫不到动态拼接的类名，走 utilities
 * 就得为 bg/text/border 各列 12 个字面量；而 `bare-raw-color` 棘轮只拦裸 hex/rgb/hsl 字面量，
 * `var()` 合规。消费方（TaskRow 标签的 `#`、TagFilterPanel 三态、项目圆点）本就是 inline style，
 * 沿用即零形态变更。
 *
 * **类型区分不靠颜色靠形状**：圆点 = 项目，`#` = 标签。同一行 meta 区两者并排时颜色只表达
 * 「是哪一个」，故项目与标签共用一组色板、偶尔撞色不构成歧义。
 *
 * 纯函数、不碰 db / DOM，故自动落 node 快桶（判定见 `packages/client/test-buckets.mjs`）。
 */
const TINT_COUNT = 12;

export const TINT_VARS: readonly string[] = Array.from(
  { length: TINT_COUNT },
  (_, i) => `var(--color-tint-${i + 1})`,
);

/**
 * 种子 → 稳定颜色（FNV-1a hash 取模色板，确定性、不存储）。
 *
 * 种子口径：项目传 `goalId`（改名不变色，色是身份不是标签），标签传标签名（标签无 id）。
 */
export function contentTint(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return TINT_VARS[(h >>> 0) % TINT_COUNT] as string;
}
