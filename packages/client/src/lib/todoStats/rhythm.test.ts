import { describe, expect, it } from "vitest";
import { rhythmMatrix } from "./rhythm.js";

describe("rhythmMatrix", () => {
  it("归属到本地时刻的星期与时段，而非 UTC 裸切割", () => {
    // UTC 2026-07-27T17:30:00Z 落在本地(Asia/Shanghai, UTC+8) 2026-07-28 01:30，
    // 即周二 0-6 时段；若误用 UTC 裸日期/小时会算成周一 12-18 时段。
    const matrix = rhythmMatrix(["2026-07-27T17:30:00.000Z"]);

    expect(matrix).toHaveLength(7);
    for (const row of matrix) {
      expect(row).toHaveLength(4);
    }

    expect(matrix[1][0]).toBe(1); // 周二(index 1)，0-6 时段
    expect(matrix[0][2]).toBe(0); // 误用 UTC 会落在的位置必须为 0

    const total = matrix.flat().reduce((sum, count) => sum + count, 0);
    expect(total).toBe(1);
  });

  it("周一为首行(index 0)，多样本按周与时段各自累加", () => {
    const matrix = rhythmMatrix([
      "2026-07-27T01:00:00.000Z", // 本地 2026-07-27 09:00，周一，6-12 时段
      "2026-07-27T01:30:00.000Z", // 本地 2026-07-27 09:30，周一，6-12 时段
      "2026-08-02T15:00:00.000Z", // 本地 2026-08-02 23:00，周日，18-24 时段
    ]);

    expect(matrix[0][1]).toBe(2); // 周一，6-12 时段累加两次
    expect(matrix[6][3]).toBe(1); // 周日，18-24 时段
  });
});
