import type { QuickNote } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { formatLocalClock, groupQuickNotesForDisplay, quickNoteAriaLabel } from "./quickNoteDisplay.js";

function note(id: string, occurredAt: string): QuickNote {
  return {
    id,
    text: id,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

describe("groupQuickNotesForDisplay", () => {
  it("formats a UTC timestamp as local HH:mm", () => {
    expect(formatLocalClock("2026-06-01T04:08:00.000Z")).toBe("12:08");
  });

  it("never emits time items", () => {
    const items = groupQuickNotesForDisplay([
      note("a", "2026-06-01T04:01:00.000Z"),
      note("b", "2026-06-01T04:08:00.000Z"),
    ]);

    expect(items.map((item) => item.type)).not.toContain("time");
  });

  it("emits only date and note items", () => {
    const items = groupQuickNotesForDisplay([note("a", "2026-06-01T04:01:00.000Z")], { today: "2026-06-10" });
    expect(items.map((item) => item.type)).toEqual(["date", "note"]);
  });

  it("adds friendly date separators across local dates", () => {
    const items = groupQuickNotesForDisplay(
      [note("a", "2026-06-01T15:59:00.000Z"), note("b", "2026-06-01T16:01:00.000Z")],
      { today: "2026-06-10" },
    );

    expect(items.filter((item) => item.type === "date").map((item) => item.label)).toEqual(["6月1日", "6月2日"]);
  });

  it("keeps the raw local date in date separator items", () => {
    const items = groupQuickNotesForDisplay([note("a", "2026-06-01T16:01:00.000Z")], { today: "2026-06-10" });

    expect(items.filter((item) => item.type === "date").map((item) => item.localDate)).toEqual(["2026-06-02"]);
  });

  it("keeps the raw local date in the separator key", () => {
    const items = groupQuickNotesForDisplay([note("a", "2026-06-01T16:01:00.000Z")], { today: "2026-06-10" });

    expect(items.filter((item) => item.type === "date").map((item) => item.key)).toEqual(["date:2026-06-02"]);
  });

  it("labels today and yesterday relative to the provided today", () => {
    const items = groupQuickNotesForDisplay(
      [note("a", "2026-06-02T04:00:00.000Z"), note("b", "2026-06-03T04:00:00.000Z")],
      { today: "2026-06-03" },
    );

    expect(items.filter((item) => item.type === "date").map((item) => item.label)).toEqual(["昨天", "今天"]);
  });

  it("includes the year for dates outside the current year", () => {
    const items = groupQuickNotesForDisplay([note("a", "2025-12-31T04:00:00.000Z")], { today: "2026-06-03" });

    expect(items.filter((item) => item.type === "date").map((item) => item.label)).toEqual(["2025年12月31日"]);
  });

  it("sorts equal timestamps by id", () => {
    const items = groupQuickNotesForDisplay([
      note("b", "2026-06-01T04:01:00.000Z"),
      note("a", "2026-06-01T04:01:00.000Z"),
    ]);

    expect(items.filter((item) => item.type === "note").map((item) => item.note.id)).toEqual(["a", "b"]);
  });
});

describe("quickNoteAriaLabel", () => {
  it("是短摘要而非整条正文：时间 + 内容", () => {
    const n = { ...note("x", "2026-06-01T04:08:00.000Z"), text: "买牛奶和鸡蛋" };
    expect(quickNoteAriaLabel(n)).toBe("速记 12:08，买牛奶和鸡蛋");
  });

  it("超长正文截断加省略号，并折叠空白", () => {
    const long = "一二三四五六七八九十".repeat(6); // 60 字
    const n = { ...note("x", "2026-06-01T04:08:00.000Z"), text: `  ${long}\n换行  ` };
    const label = quickNoteAriaLabel(n);
    expect(label.startsWith("速记 12:08，")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toContain("\n");
    expect(label.length).toBeLessThan(long.length);
  });

  it("agent 速记带来源标签", () => {
    const n = {
      ...note("x", "2026-06-01T04:08:00.000Z"),
      text: "周报已生成",
      source: "agent" as const,
      sourceLabel: "Hermes",
    };
    expect(quickNoteAriaLabel(n)).toBe("速记 12:08，Hermes · 周报已生成");
  });
});
