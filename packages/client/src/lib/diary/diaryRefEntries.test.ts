import type { TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { clipEntriesToDay } from "./diaryRefEntries.js";

function entry(id: string, startTime: string, endTime: string): TimeEntry {
  return {
    id,
    categoryId: "cat-1",
    startTime,
    endTime,
    note: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

// 东八区：2026-07-25 的日界是 UTC 2026-07-24T16:00Z .. 2026-07-25T16:00Z
describe("clipEntriesToDay", () => {
  it("完全落在当天的条目原样返回，两端都不标裁剪", () => {
    const [e] = clipEntriesToDay([entry("a", "2026-07-25T01:00:00.000Z", "2026-07-25T03:00:00.000Z")], "2026-07-25");
    expect(e.startTime).toBe("2026-07-25T01:00:00.000Z");
    expect(e.endTime).toBe("2026-07-25T03:00:00.000Z");
    expect(e.clippedStart).toBe(false);
    expect(e.clippedEnd).toBe(false);
  });

  it("跨到次日的条目，尾端裁到当天日界并标 clippedEnd", () => {
    // 本地 2026-07-25 23:00 → 2026-07-26 01:00
    const [e] = clipEntriesToDay([entry("a", "2026-07-25T15:00:00.000Z", "2026-07-25T17:00:00.000Z")], "2026-07-25");
    expect(e.endTime).toBe("2026-07-25T16:00:00.000Z");
    expect(e.clippedEnd).toBe(true);
    expect(e.clippedStart).toBe(false);
  });

  it("从前一天跨进来的条目，首端裁到当天日界并标 clippedStart", () => {
    // 本地 2026-07-24 23:00 → 2026-07-25 01:00，查 07-25
    const [e] = clipEntriesToDay([entry("a", "2026-07-24T15:00:00.000Z", "2026-07-24T17:00:00.000Z")], "2026-07-25");
    expect(e.startTime).toBe("2026-07-24T16:00:00.000Z");
    expect(e.clippedStart).toBe(true);
    expect(e.clippedEnd).toBe(false);
  });

  it("同一条跨零点条目在两天各自裁出不同时长，不会两天都显示成整段", () => {
    // 这条是「裁剪真的在做事」的判据：若不裁，两天拿到的 start/end 完全相同。
    const raw = entry("a", "2026-07-25T15:00:00.000Z", "2026-07-25T17:00:00.000Z");
    const [onDay25] = clipEntriesToDay([raw], "2026-07-25");
    const [onDay26] = clipEntriesToDay([raw], "2026-07-26");
    expect(onDay25.endTime).toBe("2026-07-25T16:00:00.000Z");
    expect(onDay26.startTime).toBe("2026-07-25T16:00:00.000Z");
    expect(onDay25.startTime).not.toBe(onDay26.startTime);
  });

  it("裁剪后长度为零的条目被丢弃", () => {
    // 本地 2026-07-24 22:00 → 24:00 整，查 07-25 时重叠为 0
    expect(clipEntriesToDay([entry("a", "2026-07-24T14:00:00.000Z", "2026-07-24T16:00:00.000Z")], "2026-07-25")).toEqual([]);
  });

  it("按裁剪后的开始时间升序", () => {
    const out = clipEntriesToDay(
      [entry("b", "2026-07-25T05:00:00.000Z", "2026-07-25T06:00:00.000Z"), entry("a", "2026-07-25T01:00:00.000Z", "2026-07-25T02:00:00.000Z")],
      "2026-07-25",
    );
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
