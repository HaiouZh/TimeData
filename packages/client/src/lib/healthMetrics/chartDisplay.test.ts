import { describe, expect, it } from "vitest";
import { buildChartRows, computeYDomain, resolveChartLayout, rollingKey } from "./chartDisplay.js";
import type { MetricSeries } from "./types.js";

function series(
  metricId: string,
  points: Array<{ date: string; value: number | null; rolling?: Record<string, number | null> }>,
): MetricSeries {
  return {
    metricId,
    label: metricId,
    unit: "",
    valueType: "number",
    points: points.map((point) => ({
      date: point.date,
      value: point.value,
      formattedValue: point.value == null ? "--" : String(point.value),
      rolling: point.rolling ?? {},
      formattedRolling: {},
    })),
  };
}

describe("rollingKey", () => {
  it("拼出滚动列键", () => {
    expect(rollingKey("hrv.value", 7)).toBe("hrv.value:rolling:7");
  });
});

describe("buildChartRows", () => {
  it("raw-single：原值与滚动键都进 row（恒等）", () => {
    const s = series("hrv.value", [
      { date: "2026-06-01", value: 40, rolling: { "7": 40 } },
      { date: "2026-06-02", value: 60, rolling: { "7": 50 } },
    ]);
    const layout = resolveChartLayout([s], "raw");
    const { dates, rows } = buildChartRows([s], layout, [7]);
    expect(dates).toEqual(["2026-06-01", "2026-06-02"]);
    expect(rows[0]).toEqual({ date: "2026-06-01", "hrv.value": 40, "hrv.value:rolling:7": 40 });
    expect(rows[1]).toEqual({ date: "2026-06-02", "hrv.value": 60, "hrv.value:rolling:7": 50 });
  });

  it("index：原值与滚动用同一基期映射", () => {
    const a = series("a", [
      { date: "d1", value: 50, rolling: { "7": 50 } },
      { date: "d2", value: 100, rolling: { "7": 75 } },
    ]);
    const b: MetricSeries = { metricId: "b", label: "b", unit: "bpm", valueType: "number", points: a.points.map((p) => ({ ...p })) };
    const c: MetricSeries = { metricId: "c", label: "c", unit: "h", valueType: "number", points: a.points.map((p) => ({ ...p })) };
    const layout = resolveChartLayout([a, b, c], "auto");
    expect(layout.mode).toBe("index");
    const { rows } = buildChartRows([a, b, c], layout, [7]);
    expect(rows[0].a).toBe(100);
    expect(rows[1].a).toBe(200);
    expect(rows[0]["a:rolling:7"]).toBe(100);
    expect(rows[1]["a:rolling:7"]).toBe(150);
  });

  it("无滚动窗时不产生滚动键", () => {
    const s = series("hrv.value", [{ date: "2026-06-01", value: 40 }]);
    const layout = resolveChartLayout([s], "raw");
    const { rows } = buildChartRows([s], layout, []);
    expect(rows[0]).toEqual({ date: "2026-06-01", "hrv.value": 40 });
  });
});

describe("computeYDomain", () => {
  it("贴合数据范围并留 padding，不从 0 起", () => {
    const rows = [
      { date: "d1", v: 55 },
      { date: "d2", v: 62 },
    ];
    const domain = computeYDomain(rows, ["v"]);
    expect(domain).not.toBeNull();
    const [lo, hi] = domain as [number, number];
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(55);
    expect(hi).toBeGreaterThan(62);
  });

  it("全等值时给对称 padding", () => {
    const rows = [
      { date: "d1", v: 60 },
      { date: "d2", v: 60 },
    ];
    expect(computeYDomain(rows, ["v"])).toEqual([57, 63]);
  });

  it("无数值返回 null（交回 recharts 自动）", () => {
    const rows = [{ date: "d1", v: null }];
    expect(computeYDomain(rows, ["v"])).toBeNull();
  });
});

describe("resolveChartLayout", () => {
  const pts = (values: Array<number | null>) =>
    values.map((value, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, "0")}`,
      value,
      formattedValue: value == null ? "--" : String(value),
      rolling: {} as Record<string, number | null>,
      formattedRolling: {} as Record<string, string>,
    }));
  const mk = (
    metricId: string,
    unit: string,
    valueType: MetricSeries["valueType"],
    values: Array<number | null>,
  ): MetricSeries => ({ metricId, label: metricId, unit, valueType, points: pts(values) });

  it("auto + 同口径(3×bpm) → raw-single 且恒等变换", () => {
    const layout = resolveChartLayout(
      [mk("hr.a", "bpm", "number", [50, 55]), mk("hr.b", "bpm", "number", [60, 65]), mk("hr.c", "bpm", "number", [40, 45])],
      "auto",
    );
    expect(layout.mode).toBe("raw-single");
    expect(layout.axisOf("hr.b")).toBe("y");
    expect(layout.transformOf("hr.a")(50)).toBe(50);
  });

  it("auto + 2 异口径 → dual-axis（序列 1 走 y1，不变换）", () => {
    const layout = resolveChartLayout([mk("hrv", "ms", "number", [40, 60]), mk("hr", "bpm", "number", [55, 58])], "auto");
    expect(layout.mode).toBe("dual-axis");
    expect(layout.axisOf("hrv")).toBe("y");
    expect(layout.axisOf("hr")).toBe("y1");
    expect(layout.transformOf("hr")(58)).toBe(58);
  });

  it("auto + 3 异口径 → index（基期=100）", () => {
    const layout = resolveChartLayout(
      [mk("hrv", "ms", "number", [42, 62]), mk("hr", "bpm", "number", [58, 55]), mk("sleep", "h", "number", [7, 8])],
      "auto",
    );
    expect(layout.mode).toBe("index");
    expect(layout.transformOf("hrv")(42)).toBe(100);
    expect(layout.transformOf("hrv")(62)).toBe(148);
  });

  it("raw：2 异口径仍 dual-axis、≥3 异口径退回 raw-single", () => {
    expect(resolveChartLayout([mk("hrv", "ms", "number", [40]), mk("hr", "bpm", "number", [55])], "raw").mode).toBe("dual-axis");
    expect(
      resolveChartLayout(
        [mk("hrv", "ms", "number", [40]), mk("hr", "bpm", "number", [55]), mk("sleep", "h", "number", [7])],
        "raw",
      ).mode,
    ).toBe("raw-single");
  });

  it("normalized：任意条数 → index", () => {
    expect(
      resolveChartLayout([mk("hr.a", "bpm", "number", [50, 55]), mk("hr.b", "bpm", "number", [60, 65])], "normalized").mode,
    ).toBe("index");
  });

  it("index 基期跳过前导 null/0；全无正值则该线缺席", () => {
    const layout = resolveChartLayout(
      [mk("a", "ms", "number", [null, 0, 50, 100]), mk("b", "bpm", "number", [70, 70]), mk("c", "h", "number", [1, 2])],
      "auto",
    );
    const t = layout.transformOf("a");
    expect(t(50)).toBe(100);
    expect(t(100)).toBe(200);
    expect(t(0)).toBe(0);
    expect(t(null)).toBeNull();
    const allZero = resolveChartLayout(
      [mk("z", "ms", "number", [0, 0]), mk("b", "bpm", "number", [1, 2]), mk("c", "h", "number", [1, 2])],
      "auto",
    ).transformOf("z");
    expect(allZero(0)).toBeNull();
  });
});
