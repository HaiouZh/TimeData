import { describe, expect, it } from "vitest";
import { subtaskOutlineDashes } from "./subtaskOutline.js";

describe("subtaskOutlineDashes", () => {
  it("total<=0 返回 null", () => {
    expect(subtaskOutlineDashes(0, 0)).toBeNull();
    expect(subtaskOutlineDashes(-1, 0)).toBeNull();
  });

  it("5 段 2 完成：轨道重复段+缺口，done 为前 2 段显式列表", () => {
    const d = subtaskOutlineDashes(5, 2)!;
    expect(d.track).toBe("15 5");
    expect(d.done).toBe("15 5 15 5 0 100");
    expect(d.offset).toBe(2.5);
  });

  it("0 完成时 done 为 null", () => {
    expect(subtaskOutlineDashes(5, 0)!.done).toBeNull();
  });

  it("done 超界被夹紧到全亮", () => {
    const d = subtaskOutlineDashes(3, 9)!;
    const dashes = d.done!.split(" ").map(Number);
    // 3 段全亮：3 组 (seg gap) + 截断对
    expect(dashes).toHaveLength(3 * 2 + 2);
  });

  it("段+缺口相加恰好铺满周长", () => {
    for (const total of [1, 2, 3, 5, 7, 12]) {
      const d = subtaskOutlineDashes(total, 1)!;
      const [seg, gap] = d.track.split(" ").map(Number);
      expect((seg + gap) * total).toBeCloseTo(100, 6);
      expect(gap).toBeGreaterThanOrEqual(3);
    }
  });

  it("total>12 退化连续：轨道整圈，done 为占比", () => {
    const d = subtaskOutlineDashes(20, 5)!;
    expect(d.track).toBe("100 0");
    expect(d.done).toBe("25 100");
    expect(d.offset).toBe(0);
  });
});