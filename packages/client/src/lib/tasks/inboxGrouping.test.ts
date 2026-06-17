import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { groupInboxByDay } from "./inboxGrouping.js";

const NOW = new Date("2026-06-17T08:00:00.000Z");
function task(id: string, createdAt: string): Task {
  return {
    id,
    title: id,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    subtasks: [],
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("groupInboxByDay", () => {
  it("空输入 → []", () => {
    expect(groupInboxByDay([], NOW)).toEqual([]);
  });

  it("今天/昨天/更早 三段，按日期新→旧", () => {
    const segs = groupInboxByDay(
      [
        task("today1", "2026-06-17T01:00:00.000Z"),
        task("yest1", "2026-06-16T01:00:00.000Z"),
        task("old1", "2026-06-09T01:00:00.000Z"),
      ],
      NOW,
    );
    expect(segs.map((s) => s.label)).toEqual(["今天", "昨天", "6月9日"]);
    expect(segs.map((s) => s.key)).toEqual(["2026-06-17", "2026-06-16", "2026-06-09"]);
  });

  it("按应用本地日界分段，而不是 UTC 日期", () => {
    const segs = groupInboxByDay([task("local-today", "2026-06-16T16:30:00.000Z")], NOW);

    expect(segs.map((s) => s.key)).toEqual(["2026-06-17"]);
    expect(segs[0]?.label).toBe("今天");
  });

  it("段内按 createdAt 倒序", () => {
    const segs = groupInboxByDay(
      [task("early", "2026-06-17T01:00:00.000Z"), task("late", "2026-06-17T07:00:00.000Z")],
      NOW,
    );
    expect(segs[0]?.tasks.map((t) => t.id)).toEqual(["late", "early"]);
  });

  it("多个更早日各自成段", () => {
    const segs = groupInboxByDay(
      [task("d9", "2026-06-09T01:00:00.000Z"), task("d10", "2026-06-10T01:00:00.000Z")],
      NOW,
    );
    expect(segs.map((s) => s.label)).toEqual(["6月10日", "6月9日"]);
  });
});
