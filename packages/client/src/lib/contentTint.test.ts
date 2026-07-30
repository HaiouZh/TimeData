import { describe, expect, it } from "vitest";
import { contentTint, TINT_VARS } from "./contentTint.js";

describe("contentTint", () => {
  it("色板恰好 12 支，全部是 var(--color-tint-N) 形态", () => {
    expect(TINT_VARS).toHaveLength(12);
    for (const v of TINT_VARS) expect(v).toMatch(/^var\(--color-tint-(?:[1-9]|1[0-2])\)$/);
  });

  it("确定性：同种子同色", () => {
    expect(contentTint("goal-abc")).toBe(contentTint("goal-abc"));
  });

  /**
   * 遍历取代采样，`toBe(12)` 取代 `> 3`——两处都是被反证逼出来的：
   * 手挑几个种子时，返回 `TINT_VARS[idx + 1]`（1/12 的种子拿到根本不存在的 `--color-tint-13`，
   * 真机上圆点与 `#` 继承成透明）能全绿；阈值写 `> 3` 时，模数从 12 退化成 4
   * （撞色率翻三倍）也能全绿。
   */
  it("12 支全部可达，且任何种子恒落在色板内（不越界、不塌档）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const tint = contentTint(`seed-${i}`);
      expect(TINT_VARS).toContain(tint);
      seen.add(tint);
    }
    expect(seen.size).toBe(12);
  });

  it("空串不抛（长度为 0 时哈希初值直接取模）", () => {
    expect(() => contentTint("")).not.toThrow();
    expect(TINT_VARS).toContain(contentTint(""));
  });
});
