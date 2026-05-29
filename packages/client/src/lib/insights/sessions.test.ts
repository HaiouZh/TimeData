import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildSessions, resolveParentId } from "./sessions.js";

function cat(id: string, parentId: string | null): Category {
  return {
    id,
    name: id,
    parentId,
    color: "#808080",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return {
    id,
    categoryId,
    startTime: start,
    endTime: end,
    note: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

const categories = [cat("p1", null), cat("c1", "p1"), cat("c2", "p1"), cat("p2", null)];

describe("resolveParentId", () => {
  it("子分类返回父 id，父分类返回自身 id", () => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    expect(resolveParentId(entry("e", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"), byId)).toBe("p1");
    expect(resolveParentId(entry("e", "p2", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"), byId)).toBe("p2");
  });

  it("未知分类返回 unknown", () => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    expect(resolveParentId(entry("e", "missing", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"), byId)).toBe("unknown");
  });
});

describe("buildSessions", () => {
  it("同父分类、间隙 <= 容差 合并为一段会话", () => {
    const entries = [
      entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),
      // 间隙 2min（<=3）且同父 p1 -> 合并
      entry("b", "c2", "2026-05-08T02:02:00.000Z", "2026-05-08T03:00:00.000Z"),
    ];
    const sessions = buildSessions(entries, categories);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ parentId: "p1", startTime: "2026-05-08T01:00:00.000Z", endTime: "2026-05-08T03:00:00.000Z", entryIds: ["a", "b"] });
    expect(sessions[0].durationMin).toBe(120);
  });

  it("间隙超容差或异父分类不合并", () => {
    const entries = [
      entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),
      // 间隙 10min > 3 -> 不合并
      entry("b", "c1", "2026-05-08T02:10:00.000Z", "2026-05-08T02:40:00.000Z"),
      // 异父 p2 -> 不合并
      entry("c", "p2", "2026-05-08T02:40:00.000Z", "2026-05-08T03:00:00.000Z"),
    ];
    expect(buildSessions(entries, categories)).toHaveLength(3);
  });

  it("乱序输入按时间排序后合并", () => {
    const entries = [
      entry("b", "c1", "2026-05-08T02:01:00.000Z", "2026-05-08T03:00:00.000Z"),
      entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),
    ];
    const sessions = buildSessions(entries, categories);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].entryIds).toEqual(["a", "b"]);
  });
});
