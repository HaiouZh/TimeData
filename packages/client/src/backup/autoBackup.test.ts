import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { backupSignature, createAutoBackup, listAutoBackups } from "./autoBackup.js";

beforeEach(async () => {
  await db.timeEntries.clear();
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

describe("backupSignature", () => {
  it("differs when entry count differs", () => {
    expect(backupSignature({ categories: [], timeEntries: [] })).not.toBe(
      backupSignature({ categories: [], timeEntries: [entry("entry-1", "2026-05-08T09:00:00.000Z")] }),
    );
  });

  it("is stable across array order", () => {
    const a = category("cat-a", "2026-05-08T09:00:00.000Z");
    const b = category("cat-b", "2026-05-08T10:00:00.000Z");

    const sig1 = backupSignature({ categories: [a, b], timeEntries: [] });
    const sig2 = backupSignature({ categories: [b, a], timeEntries: [] });

    expect(sig1).toBe(sig2);
  });

  it("differs when content differs even if count and latest updatedAt match", () => {
    const updatedAt = "2026-05-08T10:00:00.000Z";

    expect(backupSignature({ categories: [category("cat-a", updatedAt)], timeEntries: [] })).not.toBe(
      backupSignature({ categories: [{ ...category("cat-a", updatedAt), name: "changed" }], timeEntries: [] }),
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
});
