import type { TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildSearchRange } from "./range.js";
import { filterSearchEntries, summarizeSearchEntries } from "./filter.js";

function entry(id: string, categoryId: string, startLocal: string, endLocal: string, note: string | null = null): TimeEntry {
  return {
    id,
    categoryId,
    // 断言全部按 +08:00 书写，转成 UTC 存储
    startTime: new Date(`${startLocal}+08:00`).toISOString(),
    endTime: new Date(`${endLocal}+08:00`).toISOString(),
    note,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const ALL_RANGE = { startUtc: null, endUtc: null };

describe("filterSearchEntries", () => {
  it("无任何筛子时原样返回并按开始时间倒序", () => {
    const a = entry("a", "c1", "2026-02-10T09:00:00", "2026-02-10T10:00:00");
    const b = entry("b", "c1", "2026-02-14T09:00:00", "2026-02-14T10:00:00");
    const result = filterSearchEntries([a, b], { range: ALL_RANGE, categoryIds: null, terms: [] });
    expect(result.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("范围按开始时间过滤，右开区间排除边界", () => {
    const inside = entry("in", "c1", "2026-02-28T23:00:00", "2026-02-28T23:30:00");
    const boundary = entry("edge", "c1", "2026-03-01T00:00:00", "2026-03-01T01:00:00");
    const range = buildSearchRange("month", "2026-02-14");
    const result = filterSearchEntries([inside, boundary], { range, categoryIds: null, terms: [] });
    expect(result.map((e) => e.id)).toEqual(["in"]);
  });

  it("跨夜记录只按开始时间归属，不因结束时间落在范围外被排除", () => {
    // 2 月最后一天 23:00 开始、次月 07:00 结束：整条属 2 月
    const overnight = entry("night", "c1", "2026-02-28T23:00:00", "2026-03-01T07:00:00");
    const feb = filterSearchEntries([overnight], { range: buildSearchRange("month", "2026-02-14"), categoryIds: null, terms: [] });
    const mar = filterSearchEntries([overnight], { range: buildSearchRange("month", "2026-03-14"), categoryIds: null, terms: [] });
    expect(feb.map((e) => e.id)).toEqual(["night"]);
    expect(mar).toEqual([]);
  });

  it("分类筛子按 id 集合命中，涵盖直接挂父分类的记录", () => {
    const onParent = entry("p", "cat-sleep", "2026-02-10T09:00:00", "2026-02-10T10:00:00");
    const onChild = entry("c", "cat-sleep-nap", "2026-02-11T09:00:00", "2026-02-11T10:00:00");
    const other = entry("o", "cat-work", "2026-02-12T09:00:00", "2026-02-12T10:00:00");
    const result = filterSearchEntries([onParent, onChild, other], {
      range: ALL_RANGE,
      categoryIds: ["cat-sleep-nap", "cat-sleep"],
      terms: [],
    });
    expect(result.map((e) => e.id).sort()).toEqual(["c", "p"]);
  });

  it("关键词多词 AND、大小写不敏感", () => {
    const hit = entry("hit", "c1", "2026-02-10T09:00:00", "2026-02-10T10:00:00", "午后 Nap 很沉");
    const miss = entry("miss", "c1", "2026-02-11T09:00:00", "2026-02-11T10:00:00", "午后散步");
    const result = filterSearchEntries([hit, miss], { range: ALL_RANGE, categoryIds: null, terms: ["午后", "nap"] });
    expect(result.map((e) => e.id)).toEqual(["hit"]);
  });

  it("note 为 null 的记录在有关键词时不匹配", () => {
    const noNote = entry("n", "c1", "2026-02-10T09:00:00", "2026-02-10T10:00:00", null);
    expect(filterSearchEntries([noNote], { range: ALL_RANGE, categoryIds: null, terms: ["x"] })).toEqual([]);
    expect(filterSearchEntries([noNote], { range: ALL_RANGE, categoryIds: null, terms: [] })).toHaveLength(1);
  });

  it("三个筛子是 AND 关系", () => {
    const target = entry("t", "cat-sleep-nap", "2026-02-10T09:00:00", "2026-02-10T10:00:00", "补觉");
    const wrongCategory = entry("w1", "cat-work", "2026-02-10T09:00:00", "2026-02-10T10:00:00", "补觉");
    const wrongTerm = entry("w2", "cat-sleep-nap", "2026-02-10T11:00:00", "2026-02-10T12:00:00", "开会");
    const wrongRange = entry("w3", "cat-sleep-nap", "2025-02-10T09:00:00", "2025-02-10T10:00:00", "补觉");
    const result = filterSearchEntries([target, wrongCategory, wrongTerm, wrongRange], {
      range: buildSearchRange("year", "2026-02-14"),
      categoryIds: ["cat-sleep-nap"],
      terms: ["补觉"],
    });
    expect(result.map((e) => e.id)).toEqual(["t"]);
  });

  it("categoryIds 为空数组时无任何记录命中", () => {
    const any = entry("a", "c1", "2026-02-10T09:00:00", "2026-02-10T10:00:00");
    expect(filterSearchEntries([any], { range: ALL_RANGE, categoryIds: [], terms: [] })).toEqual([]);
  });
});

describe("summarizeSearchEntries", () => {
  it("空集合四个数全为 0，不除零", () => {
    expect(summarizeSearchEntries([])).toEqual({
      dayCount: 0,
      totalMinutes: 0,
      avgMinutesPerDay: 0,
      entryCount: 0,
    });
  });

  it("天数按开始日去重，同一天多条只算一天", () => {
    const a = entry("a", "c1", "2026-02-10T09:00:00", "2026-02-10T10:00:00");
    const b = entry("b", "c1", "2026-02-10T15:00:00", "2026-02-10T15:30:00");
    const c = entry("c", "c1", "2026-02-11T09:00:00", "2026-02-11T10:00:00");
    const summary = summarizeSearchEntries([a, b, c]);
    expect(summary.dayCount).toBe(2);
    expect(summary.entryCount).toBe(3);
  });

  it("时长直接累加不裁剪，跨夜整条计入", () => {
    const overnight = entry("n", "c1", "2026-02-10T23:00:00", "2026-02-11T07:00:00");
    const summary = summarizeSearchEntries([overnight]);
    expect(summary.totalMinutes).toBe(480);
    expect(summary.dayCount).toBe(1);
  });

  it("日均 = 总时长 ÷ 有记录的天数（非区间天数）", () => {
    // 复刻截图：6 条分散在 6 天、共 365 分钟
    const entries = [
      entry("1", "c1", "2026-02-14T16:51:00", "2026-02-14T17:22:00"), // 31
      entry("2", "c1", "2026-02-13T13:45:00", "2026-02-13T14:48:00"), // 63
      entry("3", "c1", "2026-02-10T15:28:00", "2026-02-10T16:08:00"), // 40
      entry("4", "c1", "2026-02-04T11:06:00", "2026-02-04T11:39:00"), // 33
      entry("5", "c1", "2026-02-02T11:38:00", "2026-02-02T12:10:00"), // 32
      entry("6", "c1", "2026-01-28T11:14:00", "2026-01-28T14:00:00"), // 166
    ];
    const summary = summarizeSearchEntries(entries);
    expect(summary.entryCount).toBe(6);
    expect(summary.dayCount).toBe(6);
    expect(summary.totalMinutes).toBe(365);
    expect(summary.avgMinutesPerDay).toBeCloseTo(365 / 6, 5);
  });
});
