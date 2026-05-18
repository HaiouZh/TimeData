import "fake-indexeddb/auto";
import type { Category, SyncLogEntry, TimeEntry } from "@timedata/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type E2EServer, startE2EServer } from "../../../../server/src/__tests__/e2e/helpers.ts";
import { db } from "../../db/index.ts";
import { regularSync, syncPull, syncPush } from "../../sync/engine.ts";
import { bindClientToServer, resetClientDb } from "./helpers.ts";

let server: E2EServer | null = null;
let restoreFetch: (() => void) | null = null;

const baseTimestamp = "2026-05-13T08:00:00.000Z";

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-e2e",
    name: "E2E",
    parentId: null,
    color: "#4A90D9",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
    ...overrides,
  };
}

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-e2e",
    categoryId: "cat-e2e",
    startTime: "2026-05-13T09:00:00.000Z",
    endTime: "2026-05-13T10:00:00.000Z",
    note: "e2e",
    createdAt: "2026-05-13T09:00:00.000Z",
    updatedAt: "2026-05-13T09:00:00.000Z",
    ...overrides,
  };
}

function syncLog(recordId: string, tableName: SyncLogEntry["tableName"]): SyncLogEntry {
  return {
    id: `log-${recordId}`,
    tableName,
    recordId,
    action: "create",
    timestamp: "2026-05-13T09:00:00.000Z",
    synced: 0,
  };
}

function insertServerCategory(item: Category): void {
  server?.db
    .prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      item.id,
      item.name,
      item.parentId,
      item.color,
      item.icon,
      item.sortOrder,
      item.isArchived ? 1 : 0,
      item.createdAt,
      item.updatedAt,
    );
}

function insertServerEntry(item: TimeEntry): void {
  server?.db
    .prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .run(item.id, item.categoryId, item.startTime, item.endTime, item.note, item.createdAt, item.updatedAt);
}

beforeEach(async () => {
  await resetClientDb();
  server = await startE2EServer();
  restoreFetch = bindClientToServer(server.app);
});

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = null;
  server?.close();
  server = null;
  await resetClientDb();
});

describe("e2e: sync round trip", () => {
  it("push then pull leaves local and server consistent", async () => {
    const localCategory = category();
    const localEntry = entry();
    await db.categories.add(localCategory);
    await db.timeEntries.add(localEntry);
    await db.syncLog.bulkAdd([syncLog(localCategory.id, "categories"), syncLog(localEntry.id, "time_entries")]);

    const result = await regularSync();

    expect(result).toMatchObject({
      checked: true,
      identical: false,
      pushed: 2,
      rejected: 0,
      pushConflicts: 0,
      conflicts: [],
    });
    expect(server?.db.prepare("SELECT id FROM categories WHERE id = ?").get(localCategory.id)).toEqual({
      id: localCategory.id,
    });
    expect(server?.db.prepare("SELECT id FROM time_entries WHERE id = ?").get(localEntry.id)).toEqual({
      id: localEntry.id,
    });
    expect(await db.syncLog.filter((log) => !log.synced).count()).toBe(0);
  });

  it("pulls server entries into an empty client", async () => {
    const remoteCategory = category({ id: "cat-remote", name: "远端" });
    const remoteEntry = entry({ id: "entry-remote", categoryId: remoteCategory.id, note: "from server" });
    insertServerCategory(remoteCategory);
    insertServerEntry(remoteEntry);

    const pulled = await syncPull({ mode: "repair" });

    expect(pulled).toBeGreaterThanOrEqual(2);
    await expect(db.categories.get(remoteCategory.id)).resolves.toMatchObject({ name: "远端" });
    await expect(db.timeEntries.get(remoteEntry.id)).resolves.toMatchObject({ note: "from server" });
  });

  it("reports push conflicts for overlapping local entries", async () => {
    const localCategory = category({ id: "cat-conflict" });
    const firstEntry = entry({
      id: "entry-first",
      categoryId: localCategory.id,
      startTime: "2026-05-13T09:00:00.000Z",
      endTime: "2026-05-13T10:00:00.000Z",
    });
    const overlappingEntry = entry({
      id: "entry-overlap",
      categoryId: localCategory.id,
      startTime: "2026-05-13T09:30:00.000Z",
      endTime: "2026-05-13T10:30:00.000Z",
    });
    await db.categories.add(localCategory);
    await db.timeEntries.bulkAdd([firstEntry, overlappingEntry]);
    await db.syncLog.bulkAdd([
      syncLog(localCategory.id, "categories"),
      syncLog(firstEntry.id, "time_entries"),
      syncLog(overlappingEntry.id, "time_entries"),
    ]);

    const result = await syncPush();

    expect(result).toMatchObject({ accepted: 2, rejected: 0, conflicts: 1 });
    expect(result.issues).toEqual([
      expect.objectContaining({ recordId: "entry-overlap", status: "conflict", reasonCode: "overlap" }),
    ]);
    await expect(db.syncLog.get("log-cat-conflict")).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get("log-entry-first")).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get("log-entry-overlap")).resolves.toMatchObject({ synced: 0 });
  });

  it("applies server tombstone deletes during pull", async () => {
    const localCategory = category({ id: "cat-delete" });
    const localEntry = entry({ id: "entry-delete", categoryId: localCategory.id });
    await db.categories.add(localCategory);
    await db.timeEntries.add(localEntry);
    server?.db
      .prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES (?, ?, ?)
    `)
      .run("time_entries", localEntry.id, "2026-05-13T11:00:00.000Z");
    server?.db
      .prepare(`
      INSERT INTO sync_seq (table_name, record_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `)
      .run("time_entries", localEntry.id, "delete", "2026-05-13T11:00:00.000Z");

    const pulled = await syncPull({ mode: "repair" });

    expect(pulled).toBeGreaterThanOrEqual(1);
    await expect(db.timeEntries.get(localEntry.id)).resolves.toBeUndefined();
  });
});
