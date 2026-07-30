/**
 * 用户内容身份色：项目与标签共用一组色板，取色机制不同（见 ADR 0026）。
 *
 * 返回 `var(--color-tint-N)` 而非 Tailwind 类名——Tailwind v4 扫不到动态拼接的类名，走 utilities
 * 就得为 bg/text/border 各列 N 个字面量；而 `bare-raw-color` 棘轮只拦裸 hex/rgb/hsl 字面量，
 * `var()` 合规。消费方（TaskRow 标签的 `#`、TagFilterPanel 三态、项目圆点）本就是 inline style，
 * 沿用即零形态变更。
 *
 * **类型区分不靠颜色靠形状**：圆点 = 项目，`#` = 标签。同一行 meta 区两者并排时颜色只表达
 * 「是哪一个」，故项目与标签共用一组色板、偶尔撞色不构成歧义。
 *
 * 纯函数、不碰 db / DOM，故自动落 node 快桶（判定见 `packages/client/test-buckets.mjs`）。
 */
const TINT_COUNT = 9;

export const TINT_VARS: readonly string[] = Array.from(
  { length: TINT_COUNT },
  (_, i) => `var(--color-tint-${i + 1})`,
);

/** FNV-1a：种子 → [0, TINT_COUNT) 的首选位。 */
function preferredIndex(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % TINT_COUNT;
}

/**
 * 标签色：种子哈希取模，确定性、不存储、**允许撞色**。
 *
 * 标签不做避撞：一条任务上的标签集合各不相同、且同屏可见的标签数远超色板宽度，
 * 「全局互不同色」既不可达也无意义——标签的主标识是它的名字。
 */
export function contentTint(seed: string): string {
  return TINT_VARS[preferredIndex(seed)] as string;
}

/**
 * 项目色：**集合内避撞分配**，返回 goalId → `var(--color-tint-N)`。
 *
 * 为什么项目要避撞而标签不用：项目同屏只有个位数、且用户是拿颜色认「这条属于哪个项目」的，
 * 而纯哈希撒点在 4 个项目时就有 54% 概率撞色（生日问题，不是「超过 9 个才撞」）——
 * 那等于没达到「各有其色」。
 *
 * **首选位仍由哈希决定**，只有被占时才顺移到下一个空位。这样颜色散布在整个色板上，
 * 而不是从 `tint-1` 依次发号（后者会让「只有三个项目」时永远看不到色板后半截）。
 *
 * `goalIds` 必须按 **createdAt 升序**传入：新建项目排在末尾，只能挤到自己，
 * 不会让已有项目换色。反过来，**删除 / 归档一个项目会让个别项目换色**——那些首选位
 * 正是被删项目占着、因而当初被顺移过的项目，此刻拿回了自己的首选位。这是避撞的固有代价，
 * 换来的是「≤9 个项目时颜色一定互不相同」。
 *
 * 项目数超过 `TINT_COUNT` 时无空位可寻，超出的部分回落到各自首选位（撞色不可避免）。
 */
export function assignProjectTints(goalIds: readonly string[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<number>();
  for (const goalId of goalIds) {
    const start = preferredIndex(goalId);
    let picked = start;
    if (used.size < TINT_COUNT) {
      for (let step = 0; step < TINT_COUNT; step++) {
        const candidate = (start + step) % TINT_COUNT;
        if (!used.has(candidate)) {
          picked = candidate;
          break;
        }
      }
    }
    used.add(picked);
    assigned.set(goalId, TINT_VARS[picked] as string);
  }
  return assigned;
}
