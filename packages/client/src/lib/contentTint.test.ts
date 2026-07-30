import { describe, expect, it } from "vitest";
import { assignProjectTints, contentTint, TINT_VARS } from "./contentTint.js";

const TINT_COUNT = 9;

describe("contentTint（标签：哈希取模，允许撞色）", () => {
  it(`色板恰好 ${TINT_COUNT} 支，全部是 var(--color-tint-N) 形态`, () => {
    expect(TINT_VARS).toHaveLength(TINT_COUNT);
    for (const v of TINT_VARS) expect(v).toMatch(/^var\(--color-tint-[1-9]\)$/);
  });

  it("确定性：同种子同色", () => {
    expect(contentTint("工作")).toBe(contentTint("工作"));
  });

  /**
   * 遍历取代采样、`toBe(9)` 取代 `> 3`——两处都是被反证逼出来的：手挑几个种子时，
   * 返回 `TINT_VARS[idx + 1]`（部分种子拿到不存在的 token，真机上圆点与 `#` 继承成透明）
   * 能全绿；阈值写 `> 3` 时色板退化成 4 支也能全绿。
   */
  it("每支都可达，且任何种子恒落在色板内（不越界、不塌档）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const tint = contentTint(`seed-${i}`);
      expect(TINT_VARS).toContain(tint);
      seen.add(tint);
    }
    expect(seen.size).toBe(TINT_COUNT);
  });

  it("空串不抛（长度为 0 时哈希初值直接取模）", () => {
    expect(() => contentTint("")).not.toThrow();
    expect(TINT_VARS).toContain(contentTint(""));
  });
});

describe("assignProjectTints（项目：集合内避撞）", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `goal-${i}`);

  it(`${TINT_COUNT} 个项目颜色互不相同`, () => {
    const assigned = assignProjectTints(ids(TINT_COUNT));
    expect(assigned.size).toBe(TINT_COUNT);
    expect(new Set(assigned.values()).size).toBe(TINT_COUNT);
  });

  it("任意规模下都不会有项目拿到空值或非色板值", () => {
    for (const n of [1, 5, TINT_COUNT, TINT_COUNT + 4, 40]) {
      for (const tint of assignProjectTints(ids(n)).values()) expect(TINT_VARS).toContain(tint);
    }
  });

  /**
   * **这条钉的是「颜色散布在整个色板上」而不是「从 tint-1 依次发号」。**
   * 若实现改成按序号发色（`picked = index % 9`），第一个项目恒拿 tint-1，本条红。
   * 用多个种子取样是必要的：单个种子有 1/9 概率恰好首选 tint-1，那样改坏了也不红。
   */
  it("首选位来自哈希：单项目时的色恒等于该 id 的 contentTint", () => {
    for (const goalId of ["goal-0", "goal-1", "goal-2", "重构同步层", "g-xyz"]) {
      expect(assignProjectTints([goalId]).get(goalId)).toBe(contentTint(goalId));
    }
  });

  /** 排序键是 createdAt、新项目排末尾，所以追加不能动已有项目的分配。 */
  it("追加新项目不改变已有项目的颜色", () => {
    const before = assignProjectTints(ids(5));
    const after = assignProjectTints(ids(6));
    for (const [goalId, tint] of before) expect(after.get(goalId)).toBe(tint);
  });

  /**
   * 与上一条对称的代价：删掉一个项目会让「当初因它而被顺移」的项目拿回首选位。
   * 这不是缺陷而是避撞的固有性质（ADR 0026 取舍），钉住它免得日后被当 bug「修」掉。
   */
  it("删掉一个项目后，其余项目仍互不撞色", () => {
    const all = ids(TINT_COUNT);
    const kept = all.filter((id) => id !== all[3]);
    const after = assignProjectTints(kept);
    expect(new Set(after.values()).size).toBe(kept.length);
  });

  it(`超过 ${TINT_COUNT} 个项目时不抛，超出的部分回落到各自首选位`, () => {
    const many = ids(TINT_COUNT + 3);
    const assigned = assignProjectTints(many);
    expect(assigned.size).toBe(many.length);
    // 前 9 个仍互不相同；后 3 个必然与前面某支重合（鸽笼原理）
    const first = many.slice(0, TINT_COUNT).map((id) => assigned.get(id));
    expect(new Set(first).size).toBe(TINT_COUNT);
    for (const id of many.slice(TINT_COUNT)) expect(assigned.get(id)).toBe(contentTint(id));
  });

  it("空集合返回空表", () => {
    expect(assignProjectTints([]).size).toBe(0);
  });
});
