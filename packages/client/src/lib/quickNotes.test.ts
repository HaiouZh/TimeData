import "fake-indexeddb/auto";
import type { TimeEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import {
  addQuickNote,
  deleteQuickNote,
  listQuickNotesByDate,
  listQuickNotesByRange,
  listQuickNotesFrom,
  listQuickNotesLatest,
  listQuickNotesNewerThan,
  listQuickNotesOlderThan,
  listQuickNotesWindow,
  updateQuickNote,
} from "./quickNotes.js";

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

describe("quick note local model", () => {
  it("adds a trimmed quick note with occurredAt defaulting to createdAt", async () => {
    const now = new Date("2026-06-01T04:01:30.123Z");

    const note = await addQuickNote("  repo  ", { now });

    expect(note).toMatchObject({
      text: "repo",
      occurredAt: "2026-06-01T04:01:30.123Z",
      createdAt: "2026-06-01T04:01:30.123Z",
      updatedAt: "2026-06-01T04:01:30.123Z",
    });
    await expect(db.quickNotes.get(note.id)).resolves.toMatchObject({ text: "repo" });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "quick_notes", recordId: note.id, action: "create", timestamp: note.updatedAt, synced: 0 },
    ]);
  });

  it("keeps createdAt as system time when backfilling occurredAt", async () => {
    const note = await addQuickNote("补录", {
      occurredAt: "2026-06-01T01:00:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });

    expect(note.occurredAt).toBe("2026-06-01T01:00:00.000Z");
    expect(note.createdAt).toBe("2026-06-01T04:00:00.000Z");
  });

  it("rejects empty text and invalid occurredAt", async () => {
    await expect(addQuickNote("   ", { now: new Date("2026-06-01T04:00:00.000Z") })).rejects.toThrow(
      "速记内容不能为空",
    );
    await expect(addQuickNote("hello", { occurredAt: "2026-06-01T12:00:00" })).rejects.toThrow();
  });

  it("lists notes by occurredAt date instead of createdAt", async () => {
    await addQuickNote("业务时间在 6 月 1 日", {
      occurredAt: "2026-05-31T16:30:00.000Z",
      now: new Date("2026-06-02T04:00:00.000Z"),
    });
    await addQuickNote("业务时间在 6 月 2 日", {
      occurredAt: "2026-06-01T16:30:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });

    await expect(listQuickNotesByDate("2026-06-01")).resolves.toMatchObject([
      { text: "业务时间在 6 月 1 日" },
    ]);
  });

  it("updates text without changing occurredAt", async () => {
    const note = await addQuickNote("old", {
      occurredAt: "2026-06-01T04:00:00.000Z",
      now: new Date("2026-06-01T04:01:00.000Z"),
    });

    const updated = await updateQuickNote(note.id, {
      text: "new",
      now: new Date("2026-06-01T05:00:00.000Z"),
    });

    expect(updated.text).toBe("new");
    expect(updated.occurredAt).toBe(note.occurredAt);
    expect(updated.updatedAt).toBe("2026-06-01T05:00:00.000Z");
    await expect(db.syncLog.where("recordId").equals(note.id).toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "quick_notes", action: "create" }),
        expect.objectContaining({ tableName: "quick_notes", action: "update", timestamp: "2026-06-01T05:00:00.000Z" }),
      ]),
    );
  });

  it("can explicitly move the business time", async () => {
    const note = await addQuickNote("move me", {
      occurredAt: "2026-05-31T16:30:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });

    await updateQuickNote(note.id, {
      occurredAt: "2026-06-01T16:30:00.000Z",
      now: new Date("2026-06-01T05:00:00.000Z"),
    });

    await expect(listQuickNotesByDate("2026-06-01")).resolves.toHaveLength(0);
    await expect(listQuickNotesByDate("2026-06-02")).resolves.toMatchObject([{ id: note.id }]);
  });

  it("deletes only the target quick note and leaves time entries untouched", async () => {
    const note = await addQuickNote("delete me", { now: new Date("2026-06-01T04:00:00.000Z") });
    await db.timeEntries.add(entry("entry-1"));

    await deleteQuickNote(note.id);

    await expect(db.quickNotes.get(note.id)).resolves.toBeUndefined();
    await expect(db.timeEntries.count()).resolves.toBe(1);
    await expect(db.syncLog.where("recordId").equals(note.id).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "quick_notes", action: "delete" })]),
    );
  });

  it("lists ranges as closed date ranges sorted by occurredAt and id", async () => {
    const first = await addQuickNote("first", {
      occurredAt: "2026-05-31T16:00:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });
    const third = await addQuickNote("third", {
      occurredAt: "2026-06-02T15:59:59.999Z",
      now: new Date("2026-06-02T04:00:00.000Z"),
    });
    const second = await addQuickNote("second", {
      occurredAt: "2026-06-01T08:00:00.000Z",
      now: new Date("2026-06-01T05:00:00.000Z"),
    });
    await addQuickNote("outside", {
      occurredAt: "2026-06-02T16:00:00.000Z",
      now: new Date("2026-06-03T04:00:00.000Z"),
    });

    const notes = await listQuickNotesByRange("2026-06-01", "2026-06-02");

    expect(notes.map((note) => note.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe("quick note windowed queries", () => {
  const t1 = "2026-06-01T00:00:00.000Z";
  const t2 = "2026-06-02T00:00:00.000Z";
  const t3 = "2026-06-03T00:00:00.000Z";
  const t4 = "2026-06-04T00:00:00.000Z";
  const t5 = "2026-06-05T00:00:00.000Z";

  async function seedFive() {
    for (const t of [t1, t2, t3, t4, t5]) {
      await addQuickNote(`note-${t}`, { occurredAt: t, now: new Date("2026-06-10T00:00:00.000Z") });
    }
  }

  function times(notes: { occurredAt: string }[]): string[] {
    return notes.map((note) => note.occurredAt);
  }

  it("listQuickNotesLatest returns the newest N ascending", async () => {
    await seedFive();

    expect(times(await listQuickNotesLatest(2))).toEqual([t4, t5]);
  });

  it("listQuickNotesOlderThan returns the newest N strictly older, ascending", async () => {
    await seedFive();

    expect(times(await listQuickNotesOlderThan(t3, 2))).toEqual([t1, t2]);
  });

  it("listQuickNotesNewerThan returns the oldest N strictly newer, ascending", async () => {
    await seedFive();

    expect(times(await listQuickNotesNewerThan(t3, 2))).toEqual([t4, t5]);
  });

  it("listQuickNotesFrom returns the oldest N from the inclusive bound, ascending", async () => {
    await seedFive();

    expect(times(await listQuickNotesFrom(t3, 10))).toEqual([t3, t4, t5]);
  });

  it("listQuickNotesWindow with a closed range is inclusive on both ends", async () => {
    await seedFive();

    expect(times(await listQuickNotesWindow(t2, t4))).toEqual([t2, t3, t4]);
  });

  it("listQuickNotesWindow with null upper bound is open to latest", async () => {
    await seedFive();

    expect(times(await listQuickNotesWindow(t3, null))).toEqual([t3, t4, t5]);
  });
});
