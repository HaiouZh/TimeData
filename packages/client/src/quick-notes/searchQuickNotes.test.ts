// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { searchQuickNotes } from "./searchQuickNotes.js";

beforeEach(async () => {
  await db.quickNotes.clear();
});

describe("searchQuickNotes", () => {
  it("returns an empty list for blank queries", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "会议纪要",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });

    await expect(searchQuickNotes("  ")).resolves.toEqual([]);
  });

  it("finds notes that contain every term case-insensitively", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "note-1",
        text: "Alpha project meeting",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "note-2",
        text: "Alpha shopping list",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);

    const results = await searchQuickNotes("alpha MEETING");

    expect(results.map((note) => note.id)).toEqual(["note-1"]);
  });

  it("sorts matching notes by occurredAt descending and id descending", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "a",
        text: "会议",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "c",
        text: "会议",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
      {
        id: "b",
        text: "会议",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);

    const results = await searchQuickNotes("会议");

    expect(results.map((note) => note.id)).toEqual(["c", "b", "a"]);
  });
});
