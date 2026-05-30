import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it, vi } from "vitest";
import {
  createInsightMemo,
  fingerprintCategories,
  fingerprintEntries,
  getCachedDailyRollups,
  memoStructure,
} from "./cache.js";

const entry = (id: string, updatedAt: string): TimeEntry => ({
  id,
  categoryId: "c",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T01:00:00.000Z",
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

const cat = (id: string, updatedAt: string): Category => ({
  id,
  name: id,
  parentId: null,
  color: "#808080",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

describe("fingerprintEntries", () => {
  it("条目数或最大 updatedAt 变化时指纹变化", () => {
    const entries = [entry("1", "2026-01-01T00:00:00.000Z"), entry("2", "2026-01-02T00:00:00.000Z")];

    expect(fingerprintEntries(entries)).toBe(fingerprintEntries([...entries].reverse()));
    expect(fingerprintEntries(entries)).not.toBe(fingerprintEntries([entry("1", "2026-01-01T00:00:00.000Z")]));
    expect(fingerprintEntries(entries)).not.toBe(
      fingerprintEntries([entry("1", "2026-01-01T00:00:00.000Z"), entry("2", "2026-01-03T00:00:00.000Z")]),
    );
  });
});

describe("fingerprintCategories", () => {
  it("分类数或最大 updatedAt 变化时指纹变化", () => {
    expect(fingerprintCategories([cat("c", "2026-01-01T00:00:00.000Z")])).not.toBe(
      fingerprintCategories([cat("c", "2026-01-02T00:00:00.000Z")]),
    );
  });
});

describe("createInsightMemo", () => {
  it("key 相同复用结果，不重复调用底层函数；key 变化则重算", () => {
    const fn = vi.fn((n: number) => n * 2);
    const memo = createInsightMemo(fn, (n: number) => String(n));

    expect(memo(3)).toBe(6);
    expect(memo(3)).toBe(6);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(memo(4)).toBe(8);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("getCachedDailyRollups", () => {
  it("窗口和数据指纹相同时复用同一引用，数据变化时失效", () => {
    const categories = [cat("c", "2026-01-01T00:00:00.000Z")];
    const entries = [entry("1", "2026-01-01T00:00:00.000Z")];

    const r1 = getCachedDailyRollups(entries, categories, "2026-01-01", "2026-01-01");
    const r2 = getCachedDailyRollups([...entries], [...categories], "2026-01-01", "2026-01-01");
    expect(r2).toBe(r1);

    const r3 = getCachedDailyRollups([entry("1", "2026-01-02T00:00:00.000Z")], categories, "2026-01-01", "2026-01-01");
    expect(r3).not.toBe(r1);
  });
});

describe("memoStructure", () => {
  const base = {
    periodEntries: [] as TimeEntry[],
    baselineEntries: [] as TimeEntry[],
    categories: [cat("c", "2026-01-01T00:00:00.000Z")],
    periodFrom: "2026-05-01",
    periodTo: "2026-05-07",
    baselineFrom: "2026-03-01",
    baselineTo: "2026-05-30",
    sleepCategoryId: null,
  };

  it("输入指纹不变时返回同一引用；变化时重算", () => {
    const r1 = memoStructure({ ...base });
    const r2 = memoStructure({ ...base });
    expect(r2).toBe(r1);

    const r3 = memoStructure({ ...base, sleepCategoryId: "c" });
    expect(r3).not.toBe(r1);
  });
});
