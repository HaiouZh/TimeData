import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { addQuickNote } from "../lib/quickNotes.js";
import {
  exportQuickNotesJsonByRange,
  exportQuickNotesMarkdownByDate,
  exportQuickNotesMarkdownByRange,
} from "./exportQuickNotes.js";

beforeEach(async () => {
  await db.quickNotes.clear();
});

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

  it("exports Markdown using display grouping", async () => {
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
});
