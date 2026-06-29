import type { QuickNote } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { importQuickNotes } from "./importQuickNotes.js";
import type { QuickNotesFile } from "./schema.js";

const baseNote: QuickNote = {
  id: "note-1",
  text: "hello",
  occurredAt: "2026-06-01T04:01:00.000Z",
  createdAt: "2026-06-01T04:01:00.000Z",
  updatedAt: "2026-06-01T04:01:00.000Z",
};

function backup(notes: QuickNote[]): QuickNotesFile {
  return {
    format: "timedata.quick-notes.backup",
    timeFormat: "utc",
    exportedAt: "2026-06-01T05:00:00.000Z",
    notes,
  };
}

beforeEach(resetDb);

describe("importQuickNotes", () => {
  it("rejects invalid format and timeFormat", async () => {
    await expect(importQuickNotes({ ...backup([]), format: "wrong" })).rejects.toThrow();
    await expect(importQuickNotes({ ...backup([]), timeFormat: "local" })).rejects.toThrow();
  });

  it("rejects invalid notes", async () => {
    await expect(importQuickNotes(backup([{ ...baseNote, text: "   " }]))).rejects.toThrow();
    await expect(importQuickNotes(backup([{ ...baseNote, occurredAt: "2026-06-01T12:01:00" }]))).rejects.toThrow();
  });

  it("inserts new notes without touching time entries", async () => {
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-work",
      startTime: "2026-06-01T01:00:00.000Z",
      endTime: "2026-06-01T02:00:00.000Z",
      note: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    await expect(importQuickNotes(backup([baseNote]))).resolves.toEqual({ inserted: 1, updated: 0, kept: 0 });
    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({ text: "hello" });
    await expect(db.timeEntries.count()).resolves.toBe(1);
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "quick_notes", recordId: "note-1", action: "create", timestamp: baseNote.updatedAt, synced: 0 },
    ]);
  });

  it("keeps newer or equal local notes and updates older local notes", async () => {
    await db.quickNotes.bulkAdd([
      { ...baseNote, id: "newer-local", text: "local", updatedAt: "2026-06-01T06:00:00.000Z" },
      { ...baseNote, id: "equal-local", text: "local", updatedAt: "2026-06-01T05:00:00.000Z" },
      { ...baseNote, id: "older-local", text: "local", updatedAt: "2026-06-01T04:00:00.000Z" },
    ]);

    await expect(
      importQuickNotes(
        backup([
          { ...baseNote, id: "newer-local", text: "incoming", updatedAt: "2026-06-01T05:00:00.000Z" },
          { ...baseNote, id: "equal-local", text: "incoming", updatedAt: "2026-06-01T05:00:00.000Z" },
          { ...baseNote, id: "older-local", text: "incoming", updatedAt: "2026-06-01T05:00:00.000Z" },
        ]),
      ),
    ).resolves.toEqual({ inserted: 0, updated: 1, kept: 2 });

    await expect(db.quickNotes.get("newer-local")).resolves.toMatchObject({ text: "local" });
    await expect(db.quickNotes.get("equal-local")).resolves.toMatchObject({ text: "local" });
    await expect(db.quickNotes.get("older-local")).resolves.toMatchObject({ text: "incoming" });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "quick_notes", recordId: "older-local", action: "update", timestamp: "2026-06-01T05:00:00.000Z" },
    ]);
  });
});
