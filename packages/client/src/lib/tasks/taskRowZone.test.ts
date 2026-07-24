import { describe, expect, it } from "vitest";
import { rowClickZone } from "./taskRowZone.js";

describe("rowClickZone", () => {
  it("左 2/5 命中区返回 expand（与有无子任务无关）", () => {
    expect(rowClickZone(0, 300)).toBe("expand");
    expect(rowClickZone(50, 300)).toBe("expand");
    expect(rowClickZone(110, 300)).toBe("expand"); // 1/3=100 之外、2/5=120 之内
  });

  it("右 3/5 返回 open", () => {
    expect(rowClickZone(130, 300)).toBe("open");
    expect(rowClickZone(299, 300)).toBe("open");
  });

  it("宽行不受旧像素上限影响", () => {
    expect(rowClickZone(300, 1000)).toBe("expand");
    expect(rowClickZone(399, 1000)).toBe("expand");
    expect(rowClickZone(401, 1000)).toBe("open");
  });
});
