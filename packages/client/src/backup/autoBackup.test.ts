import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { backupSignature, createAutoBackup, listAutoBackups } from "./autoBackup.js";

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
  await db.categories.clear();
  await db.autoBackups.clear();
});

const category = (id: string, updatedAt: string) => ({
  id,
  name: id,
  parentId: null,
  color: "#3366ff",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: updatedAt,
  updatedAt,
});

const entry = (id: string, updatedAt: string) => ({
  id,
  categoryId: "cat-1",
  startTime: "2026-05-08T09:00:00",
  endTime: "2026-05-08T10:00:00",
  note: null,
  createdAt: updatedAt,
  updatedAt,
});

const task = (id: string, updatedAt: string) => ({
  id,
  title: id,
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  sortOrder: 0,
  createdAt: updatedAt,
  updatedAt,
});

describe("backupSignature", () => {
  it("differs when entry count differs", () => {
    expect(backupSignature({ categories: [], timeEntries: [], tasks: [] })).not.toBe(
      backupSignature({ categories: [], timeEntries: [entry("entry-1", "2026-05-08T09:00:00.000Z")], tasks: [] }),
    );
  });

  it("is stable across array order", () => {
    const a = category("cat-a", "2026-05-08T09:00:00.000Z");
    const b = category("cat-b", "2026-05-08T10:00:00.000Z");

    const sig1 = backupSignature({ categories: [a, b], timeEntries: [], tasks: [] });
    const sig2 = backupSignature({ categories: [b, a], timeEntries: [], tasks: [] });

    expect(sig1).toBe(sig2);
  });

  it("differs when task content differs", () => {
    const updatedAt = "2026-06-14T00:00:00.000Z";

    expect(backupSignature({ categories: [], timeEntries: [], tasks: [task("task-1", updatedAt)] })).not.toBe(
      backupSignature({ categories: [], timeEntries: [], tasks: [{ ...task("task-1", updatedAt), done: true }] }),
    );
  });

  it("treats missing task arrays as empty for legacy automatic backups", () => {
    expect(backupSignature({ categories: [], timeEntries: [] })).toBe(
      backupSignature({ categories: [], timeEntries: [], tasks: [] }),
    );
  });

  it("differs when content differs even if count and latest updatedAt match", () => {
    const updatedAt = "2026-05-08T10:00:00.000Z";

    expect(backupSignature({ categories: [category("cat-a", updatedAt)], timeEntries: [], tasks: [] })).not.toBe(
      backupSignature({
        categories: [{ ...category("cat-a", updatedAt), name: "changed" }],
        timeEntries: [],
        tasks: [],
      }),
    );
  });
});

describe("autoBackup", () => {
  it("does not create another automatic backup when the data has not changed", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });

    await createAutoBackup();
    await createAutoBackup();

    await expect(listAutoBackups()).resolves.toHaveLength(1);
  });

  it("normalizes legacy automatic backup records without tasks", async () => {
    const existingCategory = category("cat-1", "2026-05-08T08:00:00.000Z");
    await db.categories.add(existingCategory);
    await db.autoBackups.add({
      id: "legacy-backup",
      createdAt: "2026-05-08T08:30:00.000Z",
      categories: [existingCategory],
      timeEntries: [],
    } as never);

    await createAutoBackup();

    const backups = await listAutoBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]?.tasks).toEqual([]);
  });
});
