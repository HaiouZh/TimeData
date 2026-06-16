import { describe, expect, it } from "vitest";
import { rowClickZone } from "./taskRowZone.js";

describe("rowClickZone", () => {
  it("无子任务：任何位置都开抽屉", () => {
    expect(rowClickZone(0, 300, false)).toBe("open");
    expect(rowClickZone(10, 300, false)).toBe("open");
  });

  it("有子任务：窄行左 1/3 内展开、之外开抽屉", () => {
    expect(rowClickZone(50, 300, true)).toBe("expand");
    expect(rowClickZone(150, 300, true)).toBe("open");
  });

  it("有子任务：宽行展开区封顶 140px", () => {
    expect(rowClickZone(130, 900, true)).toBe("expand");
    expect(rowClickZone(150, 900, true)).toBe("open");
  });
});
