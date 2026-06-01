import "fake-indexeddb/auto";
import type { TimeEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { addQuickNote } from "../lib/quickNotes.js";
import { deleteQuickNotesByRange } from "./deleteQuickNotesRange.js";

function entry(id: string): TimeEntry {
  return {
    id,
    categoryId: "cat-work",
    startTime: "2026-06-01T01:00:00.000Z",
    endTime: "2026-06-01T02:00:00.000Z",
    note: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

beforeEach(async () => {
  await db.quickNotes.clear();
  await db.timeEntries.clear();
  await db.syncLog.clear();
});

describe("deleteQuickNotesByRange", () => {
  it("deletes only notes in the closed local date range", async () => {
    const inFirstDay = await addQuickNote("first", {
      occurredAt: "2026-05-31T16:30:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });
    const inSecondDay = await addQuickNote("second", {
      occurredAt: "2026-06-01T16:30:00.000Z",
      now: new Date("2026-06-02T04:00:00.000Z"),
    });
    const outside = await addQuickNote("outside", {
      occurredAt: "2026-06-02T16:30:00.000Z",
      now: new Date("2026-06-03T04:00:00.000Z"),
    });
    await db.timeEntries.add(entry("entry-1"));

    await expect(deleteQuickNotesByRange("2026-06-01", "2026-06-02")).resolves.toEqual({ deleted: 2 });

    await expect(db.quickNotes.get(inFirstDay.id)).resolves.toBeUndefined();
    await expect(db.quickNotes.get(inSecondDay.id)).resolves.toBeUndefined();
    await expect(db.quickNotes.get(outside.id)).resolves.toMatchObject({ text: "outside" });
    await expect(db.timeEntries.count()).resolves.toBe(1);
    const deleteLogs = await db.syncLog.filter((log) => log.tableName === "quick_notes" && log.action === "delete").toArray();
    expect(deleteLogs.map((log) => log.recordId).sort()).toEqual([inFirstDay.id, inSecondDay.id].sort());
  });
});
