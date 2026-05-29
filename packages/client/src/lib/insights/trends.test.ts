import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildTrend, resolveTrendWindow } from "./trends.js";

function cat(id: string, parentId: string | null): Category {
  return { id, name: id, parentId, color: "#808080", icon: null, sortOrder: 0, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return { id, categoryId, startTime: start, endTime: end, note: null, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}

describe("resolveTrendWindow", () => {
  it("预设窗口 = 今天往前 N 天，上一窗口等长紧邻前移", () => {
    const w = resolveTrendWindow({ kind: "preset", days: 7 }, "2026-05-29");
    expect(w).toEqual({ from: "2026-05-23", to: "2026-05-29", prevFrom: "2026-05-16", prevTo: "2026-05-22" });
  });

  it("自定义天数同预设语义，并 clamp 到 [1,365]", () => {
    const w = resolveTrendWindow({ kind: "customDays", days: 400 }, "2026-05-29");
    expect(w.to).toBe("2026-05-29");
    expect(w.from).toBe("2025-05-30");
    const w1 = resolveTrendWindow({ kind: "customDays", days: 0 }, "2026-05-29");
    expect(w1.from).toBe("2026-05-29");
    expect(w1.to).toBe("2026-05-29");
  });

  it("自定义起止区间，上一窗口等长紧邻前移", () => {
    const w = resolveTrendWindow({ kind: "customRange", from: "2026-05-01", to: "2026-05-10" }, "2026-05-29");
    expect(w).toEqual({ from: "2026-05-01", to: "2026-05-10", prevFrom: "2026-04-21", prevTo: "2026-04-30" });
  });

  it("自定义区间 to 超过 today 时钳到 today", () => {
    const w = resolveTrendWindow({ kind: "customRange", from: "2026-05-25", to: "2026-06-30" }, "2026-05-29");
    expect(w.to).toBe("2026-05-29");
    expect(w.from).toBe("2026-05-25");
  });
});
