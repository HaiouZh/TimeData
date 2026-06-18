import { describe, expect, it } from "vitest";
import { rowClickZone } from "./taskRowZone.js";

describe("rowClickZone", () => {
  it("无子任务：任何位置都开抽屉", () => {
    expect(rowClickZone(0, 300, false)).toBe("open");
    expect(rowClickZone(10, 300, false)).toBe("open");
  });

  it("有子任务：窄行左 2/5 内展开、之外开抽屉", () => {
    // 300px 行 → 2/5 = 120px 边界
    expect(rowClickZone(50, 300, true)).toBe("expand");
    expect(rowClickZone(110, 300, true)).toBe("expand"); // 1/3=100 之外、2/5=120 之内
    expect(rowClickZone(130, 300, true)).toBe("open");
  });

  it("有子任务：宽行无 240 上限，按真 2/5 判定", () => {
    // 1000px 行 → 2/5 = 400px 边界（旧实现会被 240 封顶）
    expect(rowClickZone(399, 1000, true)).toBe("expand");
    expect(rowClickZone(300, 1000, true)).toBe("expand"); // 旧实现这里会因 >240 误判 open
    expect(rowClickZone(401, 1000, true)).toBe("open");
  });
});
