import type { HealthHrv, HealthSleep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildMetricCardItems } from "./summary.js";

function hrv(date: string, value: number): HealthHrv {
  return { id: `hrv-${date}`, date, hrvMs: value, createdAt: "x", updatedAt: "x" };
}
function sleep(date: string, start: string, wake: string): HealthSleep {
  return { id: `s-${date}`, date, sleepStart: start, wakeTime: wake, adjustmentHours: 0, createdAt: "x", updatedAt: "x" };
}

const hrvs = [hrv("2026-06-01", 40), hrv("2026-06-02", 60), hrv("2026-06-03", 50)];

describe("buildMetricCardItems", () => {
  it("多睡眠指标出多张卡（修主 bug）", () => {
    const items = buildMetricCardItems(
      { sleeps: [sleep("2026-06-01", "23:00", "07:00")] },
      ["sleep.duration", "sleep.start", "sleep.wake"],
      { mode: "all" },
      "latest",
    );
    expect(items.map((item) => item.id)).toEqual(["sleep.duration", "sleep.start", "sleep.wake"]);
    expect(items.map((item) => item.label)).toEqual(["睡眠时长", "入睡时间", "醒来时间"]);
    expect(items.every((item) => item.tone === "sleep")).toBe(true);
  });

  it("5 种聚合各自取值正确", () => {
    const value = (aggregation: Parameters<typeof buildMetricCardItems>[3]) =>
      buildMetricCardItems({ hrvs }, ["hrv.value"], { mode: "all" }, aggregation)[0].value;
    expect(value("latest")).toBe("50 ms");
    expect(value("avg")).toBe("50 ms");
    expect(value("max")).toBe("60 ms");
    expect(value("min")).toBe("40 ms");
    expect(value("sum")).toBe("150 ms");
  });

  it("latest/max/min 标极值日，avg/sum 标区间", () => {
    const detail = (aggregation: Parameters<typeof buildMetricCardItems>[3], range: Parameters<typeof buildMetricCardItems>[2]) =>
      buildMetricCardItems({ hrvs }, ["hrv.value"], range, aggregation)[0].detail;
    expect(detail("latest", { mode: "all" })).toBe("最新·06-03");
    expect(detail("max", { mode: "all" })).toBe("最大·06-02");
    expect(detail("min", { mode: "all" })).toBe("最小·06-01");
    expect(detail("avg", { mode: "all" })).toBe("均值·06-01~06-03");
    expect(detail("sum", { mode: "recent", days: 7 })).toBe("合计·近7日");
  });

  it("全为空 → 值 -- 且副文暂无数据", () => {
    const items = buildMetricCardItems({}, ["hrv.value"], { mode: "all" }, "latest");
    expect(items[0].value).toBe("--");
    expect(items[0].detail).toBe("暂无数据");
  });

  it("tone 按前缀映射", () => {
    const items = buildMetricCardItems(
      { sleeps: [sleep("2026-06-01", "23:00", "07:00")], hrvs },
      ["sleep.duration", "hrv.value", "heart_rate.resting", "stress.value", "run.distance"],
      { mode: "all" },
      "latest",
    );
    expect(items.map((item) => item.tone)).toEqual(["sleep", "hrv", "heart", "stress", "run"]);
  });
});
