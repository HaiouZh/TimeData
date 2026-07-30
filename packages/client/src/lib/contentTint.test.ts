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

  it("返回值恒在色板内", () => {
    for (const seed of ["a", "工作", "goal-01H9", "", "很长很长很长的标签名"]) {
      expect(TINT_VARS).toContain(contentTint(seed));
    }
  });

  it("不同种子分布到多支，不塌成一色", () => {
    const seeds = ["工作", "生活", "紧急", "学习", "健康", "财务", "家庭", "项目", "写作", "重构"];
    expect(new Set(seeds.map(contentTint)).size).toBeGreaterThan(3);
  });

  it("空串也返回合法色（不抛、不返回 undefined）", () => {
    expect(TINT_VARS).toContain(contentTint(""));
  });
});
