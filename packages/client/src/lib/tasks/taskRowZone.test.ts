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

  it("有子任务：宽行展开区封顶 240px", () => {
    expect(rowClickZone(230, 900, true)).toBe("expand");
    expect(rowClickZone(250, 900, true)).toBe("open");
  });
});
