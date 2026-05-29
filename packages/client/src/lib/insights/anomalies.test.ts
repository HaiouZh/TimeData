import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { detectAnomalies } from "./anomalies.js";

function cat(id: string, parentId: string | null): Category {
  return { id, name: id, parentId, color: "#808080", icon: null, sortOrder: 0, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return { id, categoryId, startTime: start, endTime: end, note: null, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
const categories = [cat("work", null), cat("sleep", null), cat("nap", "sleep")];

describe("detectAnomalies", () => {
  it("超长记录排除睡眠：睡眠 10h 不报，工作 10h 报", () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, i) =>
        entry(`w${i}`, "work", `2026-05-0${(i % 8) + 1}T01:00:00.000Z`, `2026-05-0${(i % 8) + 1}T02:00:00.000Z`),
      ),
      entry("long-work", "work", "2026-05-08T03:00:00.000Z", "2026-05-08T13:00:00.000Z"), // 10h
      entry("long-sleep", "nap", "2026-05-09T15:00:00.000Z", "2026-05-10T01:00:00.000Z"), // 10h 睡眠
    ];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-01", toDate: "2026-05-10", sleepCategoryId: "sleep" });
    const overlong = anomalies.filter((a) => a.type === "overlong");
    expect(overlong.some((a) => a.categoryId === "work")).toBe(true);
    expect(overlong.some((a) => a.categoryId === "nap")).toBe(false);
  });

  it("跨午夜条目报 overnight", () => {
    const entries = [entry("x", "work", "2026-05-08T14:00:00.000Z", "2026-05-08T18:00:00.000Z")]; // +8 跨 24:00
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-08", toDate: "2026-05-09", sleepCategoryId: "sleep" });
    expect(anomalies.some((a) => a.type === "overnight" && a.categoryId === "work")).toBe(true);
  });

  it("非睡眠活动落在通常睡眠时段报 sleepTimeActivity", () => {
    // 03:00(+8) 工作 = 2026-05-07T19:00Z，落在 23:00~07:00 睡眠窗
    const entries = [entry("y", "work", "2026-05-07T19:00:00.000Z", "2026-05-07T20:00:00.000Z")];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-08", toDate: "2026-05-08", sleepCategoryId: "sleep" });
    expect(anomalies.some((a) => a.type === "sleepTimeActivity")).toBe(true);
  });

  it("完全无记录的日报 unrecordedDay", () => {
    const entries = [entry("a", "work", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z")];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-08", toDate: "2026-05-10", sleepCategoryId: "sleep" });
    const days = anomalies.filter((a) => a.type === "unrecordedDay").map((a) => a.date);
    expect(days).toContain("2026-05-09");
    expect(days).toContain("2026-05-10");
    expect(days).not.toContain("2026-05-08");
  });

  it("清醒时段长空白超 fallback 报 longGap（样本不足走 90min 兜底）", () => {
    // 同日 09:00~10:00 与 14:00~15:00 (+8)，中间 4h 清醒空档 > 90
    const entries = [
      entry("a", "work", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),
      entry("b", "work", "2026-05-08T06:00:00.000Z", "2026-05-08T07:00:00.000Z"),
    ];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-08", toDate: "2026-05-08", sleepCategoryId: "sleep" });
    expect(anomalies.some((a) => a.type === "longGap")).toBe(true);
  });

  it("sleepCategoryId=null 时不排除睡眠：睡眠超长记录也会报", () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, i) =>
        entry(`w${i}`, "work", `2026-05-0${(i % 8) + 1}T01:00:00.000Z`, `2026-05-0${(i % 8) + 1}T02:00:00.000Z`),
      ),
      entry("long-sleep", "nap", "2026-05-09T15:00:00.000Z", "2026-05-10T01:00:00.000Z"), // 10h 睡眠
    ];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-01", toDate: "2026-05-10", sleepCategoryId: null });
    // 未指定睡眠分类 -> 睡眠 10h 也算超长
    expect(anomalies.some((a) => a.type === "overlong" && a.categoryId === "nap")).toBe(true);
  });

  it("空 entries 时范围内每天报 unrecordedDay，其余类不报", () => {
    const anomalies = detectAnomalies({ entries: [], categories, fromDate: "2026-05-08", toDate: "2026-05-09", sleepCategoryId: "sleep" });
    expect(anomalies.filter((a) => a.type === "unrecordedDay").map((a) => a.date)).toEqual(["2026-05-09", "2026-05-08"]);
    expect(anomalies.every((a) => a.type === "unrecordedDay")).toBe(true);
  });

  it("归属日落在 [fromDate,toDate] 外的越界跨天条目不报（Dexie 会带回前一天起始的条目）", () => {
    // 该条 +8 = 2026-05-07 23:00 ~ 2026-05-08 09:00，归属日 05-07 在范围外；它会跨午夜且超长
    const entries = [entry("cross", "work", "2026-05-07T15:00:00.000Z", "2026-05-08T01:00:00.000Z")];
    const anomalies = detectAnomalies({ entries, categories, fromDate: "2026-05-08", toDate: "2026-05-08", sleepCategoryId: "sleep" });
    // overlong/overnight/sleepTimeActivity 均按归属日 05-07 裁掉，不应出现
    expect(anomalies.some((a) => a.type === "overlong")).toBe(false);
    expect(anomalies.some((a) => a.type === "overnight")).toBe(false);
    expect(anomalies.some((a) => a.type === "sleepTimeActivity")).toBe(false);
  });
});
