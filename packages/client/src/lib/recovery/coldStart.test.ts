import { describe, expect, it } from "vitest";
import { buildColdStartReport, computeColdStartSegments } from "./coldStart.js";

describe("冷启动分段", () => {
  it("两段分别是 JS 解析与 React 挂载", () => {
    expect(
      computeColdStartSegments({ cause: "external", domContentLoadedMs: 400, firstPaintMs: 950 }),
    ).toEqual({ parseMs: 400, mountMs: 550 });
  });

  it("首帧还没到时 mount 段为 null，不拿 0 冒充", () => {
    expect(
      computeColdStartSegments({ cause: "cold", domContentLoadedMs: 400, firstPaintMs: null }),
    ).toEqual({ parseMs: 400, mountMs: null });
  });

  it("时序倒挂时夹到 0，不产生负数污染统计", () => {
    expect(
      computeColdStartSegments({ cause: "cold", domContentLoadedMs: 400, firstPaintMs: 300 }),
    ).toEqual({ parseMs: 400, mountMs: 0 });
  });

  it("耗时取整", () => {
    expect(
      computeColdStartSegments({ cause: "cold", domContentLoadedMs: 400.6, firstPaintMs: 950.2 }),
    ).toEqual({ parseMs: 401, mountMs: 550 });
  });
});

describe("上报条目", () => {
  it("action 固定，detail 带归因与分段", () => {
    const report = buildColdStartReport({ cause: "external", domContentLoadedMs: 400, firstPaintMs: 950 });
    expect(report.action).toBe("cold_start");
    expect(report.record_count).toBe(0);
    expect(JSON.parse(report.detail)).toEqual({ cause: "external", parseMs: 400, mountMs: 550 });
  });
});
