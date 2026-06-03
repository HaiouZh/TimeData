import type { QuickNote } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { groupQuickNotesForDisplay } from "./quickNoteDisplay.js";

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
  it("uses one timestamp for notes in the same local minute", () => {
    const items = groupQuickNotesForDisplay([
      note("a", "2026-06-01T04:01:00.000Z"),
      note("b", "2026-06-01T04:01:30.000Z"),
    ]);

    expect(items.filter((item) => item.type === "time")).toHaveLength(1);
  });

  it("keeps close cross-minute notes under the previous timestamp", () => {
    const items = groupQuickNotesForDisplay([
      note("a", "2026-06-01T04:01:00.000Z"),
      note("b", "2026-06-01T04:04:00.000Z"),
    ]);

    expect(items.filter((item) => item.type === "time")).toHaveLength(1);
  });

  it("creates a new timestamp after the gap threshold", () => {
    const items = groupQuickNotesForDisplay([
      note("a", "2026-06-01T04:01:00.000Z"),
      note("b", "2026-06-01T04:08:00.000Z"),
    ]);

    expect(items.filter((item) => item.type === "time").map((item) => item.label)).toEqual(["12:01", "12:08"]);
  });

  it("adds friendly date separators across local dates", () => {
    const items = groupQuickNotesForDisplay(
      [note("a", "2026-06-01T15:59:00.000Z"), note("b", "2026-06-01T16:01:00.000Z")],
      { today: "2026-06-10" },
    );

    expect(items.filter((item) => item.type === "date").map((item) => item.label)).toEqual(["6月1日", "6月2日"]);
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
