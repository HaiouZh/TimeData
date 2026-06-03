import { describe, expect, it } from "vitest";
import { rowToQuickNote, type QuickNoteRow } from "./db-rows.js";

const baseRow: QuickNoteRow = {
  id: "note-1",
  text: "hi",
  occurred_at: "2026-06-03T00:00:00.000Z",
  created_at: "2026-06-03T00:00:00.000Z",
  updated_at: "2026-06-03T00:00:00.000Z",
  source: null,
  source_label: null,
};

describe("rowToQuickNote", () => {
  it("omits source metadata for legacy rows", () => {
    const note = rowToQuickNote(baseRow);

    expect(note.source).toBeUndefined();
    expect(note.sourceLabel).toBeUndefined();
  });

  it("maps agent source metadata", () => {
    const note = rowToQuickNote({ ...baseRow, source: "agent", source_label: "Hermes" });

    expect(note.source).toBe("agent");
    expect(note.sourceLabel).toBe("Hermes");
  });
});
