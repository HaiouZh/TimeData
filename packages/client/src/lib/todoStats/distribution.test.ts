import { describe, expect, it } from "vitest";
import { completionRate, weeklyDistribution } from "./distribution.ts";

describe("weeklyDistribution", () => {
  it("按周聚合并对空周补 0，周一为周首", () => {
    // today = 2026-07-28（周二），近 3 周：本周(07-27)、上周(07-20)、上上周(07-13)
    const events = [
      "2026-07-27T09:00:00.000Z", // 本周一，落在 07-27 那周（注意：UTC 时间会经 APP_TIME_ZONE 转换，这里选安全的中午时刻）
      "2026-07-13T05:00:00.000Z", // 上上周一
      "2026-07-13T10:00:00.000Z", // 同一周再来一条，验证计数累加
    ];
    const result = weeklyDistribution(events, "2026-07-28", 3);

    expect(result).toEqual([
      { weekStart: "2026-07-13", count: 2 },
      { weekStart: "2026-07-20", count: 0 },
      { weekStart: "2026-07-27", count: 1 },
    ]);
  });

  it("weeks 数量与顺序：近 N 周含今日所在周，按时间升序排列", () => {
    const result = weeklyDistribution([], "2026-07-28", 12);
    expect(result).toHaveLength(12);
    expect(result[11].weekStart).toBe("2026-07-27"); // 本周一
    expect(result[0].weekStart).toBe("2026-05-11");
  });
});

describe("completionRate", () => {
  it("按周对齐创建与完成事件数，分母为 0 时返回原始 0（不做除法/文案，由组件处理）", () => {
    const created = ["2026-07-27T09:00:00.000Z", "2026-07-27T10:00:00.000Z"];
    const completed = ["2026-07-27T11:00:00.000Z"];
    const result = completionRate(created, completed, "2026-07-28", 2);

    expect(result).toEqual([
      { weekStart: "2026-07-20", created: 0, completed: 0 },
      { weekStart: "2026-07-27", created: 2, completed: 1 },
    ]);
  });
});
