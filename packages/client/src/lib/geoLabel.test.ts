import { describe, expect, it } from "vitest";
import { geoLabel } from "./geoLabel.ts";

describe("geoLabel", () => {
  it("国家与城市都有时用 · 连接", () => {
    expect(geoLabel("中国", "上海")).toBe("中国 · 上海");
  });

  it("只有国家时只显示国家", () => {
    expect(geoLabel("美国", null)).toBe("美国");
  });

  it("两者都缺时显示位置未知", () => {
    expect(geoLabel(null, null)).toBe("位置未知");
  });

  it("空字符串视同缺失", () => {
    expect(geoLabel("", "")).toBe("位置未知");
  });
});
