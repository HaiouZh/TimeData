import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { resolveConflicts } from "./conflicts.js";

beforeEach(async () => {
  await db.categories.clear();
  await db.timeEntries.clear();
  await db.syncLog.clear();
});

describe("resolveConflicts", () => {
  it("writes remote category and marks pending sync logs for the same record as synced", async () => {
    const id = "cat-a";
    const local = {
      id,
      name: "local",
      parentId: null,
      color: "#000000",
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    };
    const remote = {
      ...local,
      name: "remote",
      color: "#FFFFFF",
      updatedAt: "2026-05-08T01:00:00.000Z",
    };
    await db.categories.put(local);
    await db.syncLog.bulkAdd([
      {
        id: "log-1",
        tableName: "categories",
        recordId: id,
        action: "update",
        timestamp: "2026-05-08T00:30:00.000Z",
        synced: 0,
      },
      {
        id: "log-2",
        tableName: "time_entries",
        recordId: id,
        action: "update",
        timestamp: "2026-05-08T00:30:00.000Z",
        synced: 0,
      },
    ]);

    const applied = await resolveConflicts([
      { tableName: "categories", recordId: id, local, remote, remoteAction: "update" },
    ], "use_remote");

    expect(applied).toBe(1);
    await expect(db.categories.get(id)).resolves.toMatchObject({ name: "remote" });
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get("log-2")).resolves.toMatchObject({ synced: 0 });
  });

  it("deletes local entry when accepting a remote delete conflict", async () => {
    const local = {
      id: "entry-delete-conflict",
      categoryId: "cat-local",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "local pending",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    };
    await db.timeEntries.put(local);
    await db.syncLog.add({
      id: "log-entry-delete-conflict",
      tableName: "time_entries",
      recordId: local.id,
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: false,
    });

    const applied = await resolveConflicts([
      { tableName: "time_entries", recordId: local.id, local, remote: null, remoteAction: "delete" },
    ], "use_remote");

    expect(applied).toBe(1);
    await expect(db.timeEntries.get(local.id)).resolves.toBeUndefined();
    await expect(db.syncLog.where("recordId").equals(local.id).toArray()).resolves.toEqual([]);
  });

  it("deletes local category tree and pending logs when accepting a remote category delete conflict", async () => {
    const work = {
      id: "work",
      name: "工作",
      parentId: null,
      color: "#4A90D9",
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    };
    const workCode = {
      ...work,
      id: "work-code",
      name: "编码",
      parentId: "work",
      updatedAt: "2026-05-08T01:00:00.000Z",
    };
    await db.categories.bulkAdd([work, workCode]);
    await db.timeEntries.put({
      id: "entry-work-code",
      categoryId: "work-code",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: null,
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.bulkAdd([
      {
        id: "log-work-code",
        tableName: "categories",
        recordId: "work-code",
        action: "update",
        timestamp: "2026-05-08T01:00:00.000Z",
        synced: false,
      },
      {
        id: "log-entry-work-code",
        tableName: "time_entries",
        recordId: "entry-work-code",
        action: "update",
        timestamp: "2026-05-08T09:00:00.000Z",
        synced: false,
      },
    ]);

    const applied = await resolveConflicts([
      { tableName: "categories", recordId: "work", local: work, remote: null, remoteAction: "delete" },
    ], "use_remote");

    expect(applied).toBe(1);
    await expect(db.categories.get("work")).resolves.toBeUndefined();
    await expect(db.categories.get("work-code")).resolves.toBeUndefined();
    await expect(db.timeEntries.get("entry-work-code")).resolves.toBeUndefined();
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("does nothing when keeping local conflicts", async () => {
    const applied = await resolveConflicts([], "keep_local");

    expect(applied).toBe(0);
  });
});
