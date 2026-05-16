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
        synced: false,
      },
      {
        id: "log-2",
        tableName: "time_entries",
        recordId: id,
        action: "update",
        timestamp: "2026-05-08T00:30:00.000Z",
        synced: false,
      },
    ]);

    const applied = await resolveConflicts([
      { tableName: "categories", recordId: id, local, remote },
    ], "use_remote");

    expect(applied).toBe(1);
    await expect(db.categories.get(id)).resolves.toMatchObject({ name: "remote" });
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get("log-2")).resolves.toMatchObject({ synced: false });
  });

  it("does nothing when keeping local conflicts", async () => {
    const applied = await resolveConflicts([], "keep_local");

    expect(applied).toBe(0);
  });
});
