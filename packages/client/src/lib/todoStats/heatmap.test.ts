import { describe, expect, it } from "vitest";
import { heatmapCells } from "./heatmap.js";

describe("heatmapCells", () => {
  it("空数据全 0", () => {
    const cells = heatmapCells([], "2026-07-24", 1);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.count).toBe(0);
      expect(cell.level).toBe(0);
    }
  });

  it("首尾日期对齐：首列从 today 前所在周的周一起，末尾是 today", () => {
    // 2026-07-24 是周五，所在周周一是 2026-07-20（events.test.ts 已验证的口径）
    const cells = heatmapCells([], "2026-07-24", 1);
    expect(cells[0].date).toBe("2026-07-20");
    expect(cells[cells.length - 1].date).toBe("2026-07-24");
    expect(cells.length).toBe(5);
  });

  it("level 按分位数分档：max>=4 时按 max 四等分", () => {
    const completed = [
      // 2026-07-20: 2 次
      "2026-07-20T04:00:00.000Z",
      "2026-07-20T05:00:00.000Z",
      // 2026-07-21: 3 次
      "2026-07-21T04:00:00.000Z",
      "2026-07-21T05:00:00.000Z",
      "2026-07-21T06:00:00.000Z",
      // 2026-07-22: 5 次
      "2026-07-22T01:00:00.000Z",
      "2026-07-22T02:00:00.000Z",
      "2026-07-22T03:00:00.000Z",
      "2026-07-22T04:00:00.000Z",
      "2026-07-22T05:00:00.000Z",
      // 2026-07-23: 0 次
      // 2026-07-24(today): 8 次，全局 max
      "2026-07-24T00:30:00.000Z",
      "2026-07-24T01:00:00.000Z",
      "2026-07-24T02:00:00.000Z",
      "2026-07-24T03:00:00.000Z",
      "2026-07-24T04:00:00.000Z",
      "2026-07-24T05:00:00.000Z",
      "2026-07-24T06:00:00.000Z",
      "2026-07-24T07:00:00.000Z",
    ];
    const cells = heatmapCells(completed, "2026-07-24", 1);
    const byDate = new Map(cells.map((cell) => [cell.date, cell]));

    // max=8, q=2: level = ceil(count/2)
    expect(byDate.get("2026-07-20")).toMatchObject({ count: 2, level: 1 });
    expect(byDate.get("2026-07-21")).toMatchObject({ count: 3, level: 2 });
    expect(byDate.get("2026-07-22")).toMatchObject({ count: 5, level: 3 });
    expect(byDate.get("2026-07-23")).toMatchObject({ count: 0, level: 0 });
    expect(byDate.get("2026-07-24")).toMatchObject({ count: 8, level: 4 });
  });

  it("level 分档口径：max<4 时 count 即 level 封顶 4", () => {
    const completed = [
      "2026-07-21T04:00:00.000Z",
      "2026-07-21T05:00:00.000Z",
      "2026-07-24T04:00:00.000Z",
    ];
    const cells = heatmapCells(completed, "2026-07-24", 1);
    const byDate = new Map(cells.map((cell) => [cell.date, cell]));

    // max=2（07-21 有 2 次），count 本身即 level
    expect(byDate.get("2026-07-21")).toMatchObject({ count: 2, level: 2 });
    expect(byDate.get("2026-07-24")).toMatchObject({ count: 1, level: 1 });
  });
});
