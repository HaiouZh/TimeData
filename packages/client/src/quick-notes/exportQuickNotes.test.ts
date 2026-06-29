import { beforeEach, describe, expect, it } from "vitest";
import { addQuickNote } from "../lib/quickNotes.js";
import { resetDb } from "../test/dbReset.js";
import {
  exportQuickNotesJsonByRange,
  exportQuickNotesJsonForNotes,
  exportQuickNotesMarkdownByDate,
  exportQuickNotesMarkdownByRange,
} from "./exportQuickNotes.js";

beforeEach(resetDb);

describe("export quick notes", () => {
  it("exports JSON with only quick notes", async () => {
    await addQuickNote("repo", {
      occurredAt: "2026-06-01T04:01:00.000Z",
      now: new Date("2026-06-01T04:02:00.000Z"),
    });

    const backup = await exportQuickNotesJsonByRange("2026-06-01", "2026-06-01", {
      now: () => "2026-06-01T05:00:00.000Z",
    });

    expect(backup).toMatchObject({
      format: "timedata.quick-notes.backup",
      timeFormat: "utc",
      exportedAt: "2026-06-01T05:00:00.000Z",
      notes: [expect.objectContaining({ text: "repo" })],
    });
    expect(backup).not.toHaveProperty("timeEntries");
    expect(backup).not.toHaveProperty("categories");
    expect(backup).not.toHaveProperty("settings");
  });

  it("exports Markdown with time headings", async () => {
    await addQuickNote("预算系统两层", {
      occurredAt: "2026-06-01T04:01:00.000Z",
      now: new Date("2026-06-01T04:01:00.000Z"),
    });
    await addQuickNote("repo", {
      occurredAt: "2026-06-01T04:01:30.000Z",
      now: new Date("2026-06-01T04:01:30.000Z"),
    });
    await addQuickNote("下午看同步文档", {
      occurredAt: "2026-06-01T04:08:00.000Z",
      now: new Date("2026-06-01T04:08:00.000Z"),
    });

    await expect(exportQuickNotesMarkdownByDate("2026-06-01")).resolves.toBe(
      "# 速记 2026-06-01\n\n## 12:01\n\n预算系统两层\n\nrepo\n\n## 12:08\n\n下午看同步文档\n",
    );
  });

  it("exports empty Markdown documents", async () => {
    await expect(exportQuickNotesMarkdownByRange("2026-06-01", "2026-06-02")).resolves.toBe(
      "# 速记 2026-06-01 至 2026-06-02\n\n无速记\n",
    );
  });

  it("exports a selected note array as JSON backup", () => {
    const backup = exportQuickNotesJsonForNotes(
      [
        {
          id: "note-a",
          text: "一",
          occurredAt: "2026-06-01T01:00:00.000Z",
          createdAt: "2026-06-01T01:00:00.000Z",
          updatedAt: "2026-06-01T01:00:00.000Z",
        },
        {
          id: "note-b",
          text: "二",
          occurredAt: "2026-06-01T02:00:00.000Z",
          createdAt: "2026-06-01T02:00:00.000Z",
          updatedAt: "2026-06-01T02:00:00.000Z",
        },
      ],
      { now: () => "2026-06-04T00:00:00.000Z" },
    );

    expect(backup).toMatchObject({
      format: "timedata.quick-notes.backup",
      timeFormat: "utc",
      exportedAt: "2026-06-04T00:00:00.000Z",
    });
    expect(backup.notes.map((note) => note.id)).toEqual(["note-a", "note-b"]);
  });
});
