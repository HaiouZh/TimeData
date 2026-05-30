import type { Category, Setting, SyncChange, SyncPushOutcome, TimeEntry } from "@timedata/shared";
import type { Database } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import type { CategoryRow, EntryRow } from "../lib/db-rows.js";
import { recordSeq } from "./seq.js";

type CategoryChange = Extract<SyncChange, { tableName: "categories" }>;
type EntryChange = Extract<SyncChange, { tableName: "time_entries" }>;
type SettingChange = Extract<SyncChange, { tableName: "settings" }>;

export interface ApplyChangeResult {
  recordId: string;
  tableName: SyncChange["tableName"];
  action: SyncChange["action"];
  status: "applied" | "skipped";
  reason: string;
  serverUpdatedAt?: string;
  incomingTimestamp: string;
  skipReason?: SyncPushOutcome["reasonCode"];
  overriddenRecordIds?: string[];
}

export function applyChange(change: SyncChange): ApplyChangeResult {
  const db = getDb();
  let changeResult: ApplyChangeResult;
  if (change.tableName === "categories") {
    changeResult = applyCategoryChange(db, change);
  } else if (change.tableName === "time_entries") {
    changeResult = applyEntryChange(db, change);
  } else {
    changeResult = applySettingChange(db, change);
  }

  // 只有成功写入才推进 seq cursor，skipped 的变更不占 seq 位置（供上游判断应用顺序）。
  if (changeResult.status === "applied") {
    recordSeq(change.tableName, change.recordId, change.action);
  }

  return changeResult;
}

function applySettingChange(db: Database, change: SettingChange): ApplyChangeResult {
  if (change.action === "delete") {
    db.prepare("DELETE FROM settings WHERE key = ?").run(change.recordId);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('settings', ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run(change.recordId, change.timestamp);
    return result(change, "applied", "deleted setting");
  }

  const data: Setting = change.data;
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(data.key, data.value, change.timestamp);
  return result(change, "applied", "upserted setting");
}

function applyCategoryChange(db: Database, change: CategoryChange): ApplyChangeResult {
  if (change.action === "delete") {
    const categoryIds = [change.recordId];
    for (let index = 0; index < categoryIds.length; index++) {
      const parentId = categoryIds[index];
      const childRows = db
        .prepare("SELECT id FROM categories WHERE parent_id = ? ORDER BY sort_order, id")
        .all(parentId) as Array<{ id: string }>;
      categoryIds.push(...childRows.map((row) => row.id));
    }

    const insertEntryTombstone = db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('time_entries', ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `);
    const insertCategoryTombstone = db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('categories', ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `);
    const cascadedEntryIds: string[] = [];

    for (const categoryId of [...categoryIds].reverse()) {
      const entries = db
        .prepare("SELECT id FROM time_entries WHERE category_id = ? ORDER BY id")
        .all(categoryId) as Array<{ id: string }>;
      for (const entry of entries) {
        db.prepare("DELETE FROM time_entries WHERE id = ?").run(entry.id);
        insertEntryTombstone.run(entry.id, change.timestamp);
        recordSeq("time_entries", entry.id, "delete");
        cascadedEntryIds.push(entry.id);
      }
      db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
      insertCategoryTombstone.run(categoryId, change.timestamp);
      recordSeq("categories", categoryId, "delete");
    }

    return result(change, "applied", "deleted category", undefined, cascadedEntryIds);
  }

  const data: Category = change.data;

  const existing = db.prepare("SELECT updated_at FROM categories WHERE id = ?").get(change.recordId) as
    | Pick<CategoryRow, "updated_at">
    | undefined;

  // 服务端用 syncLog 时间作为 updated_at，避免 payload.updatedAt 受客户端时钟漂移影响。
  if (existing) {
    db.prepare(`
      UPDATE categories SET name = ?, parent_id = ?, color = ?, icon = ?, sort_order = ?, is_archived = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.name,
      data.parentId,
      data.color,
      data.icon,
      data.sortOrder,
      data.isArchived ? 1 : 0,
      change.timestamp,
      change.recordId,
    );
    return result(change, "applied", "updated category", existing.updated_at);
  }

  db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id,
    data.name,
    data.parentId,
    data.color,
    data.icon,
    data.sortOrder,
    data.isArchived ? 1 : 0,
    data.createdAt,
    change.timestamp,
  );
  return result(change, "applied", "inserted category");
}

// 删除与新记录时间段重叠的现有记录，并写 tombstone + seq，返回被删除的 ID 列表。
function deleteOverlappingEntries(db: Database, data: TimeEntry, deletedAt: string): string[] {
  const rows = db
    .prepare(`
    SELECT id FROM time_entries
    WHERE id != ? AND start_time < ? AND end_time > ?
    ORDER BY start_time, id
  `)
    .all(data.id, data.endTime, data.startTime) as Array<{ id: string }>;

  const insertTombstone = db.prepare(`
    INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
    VALUES ('time_entries', ?, ?)
    ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
  `);

  for (const row of rows) {
    db.prepare("DELETE FROM time_entries WHERE id = ?").run(row.id);
    insertTombstone.run(row.id, deletedAt);
    recordSeq("time_entries", row.id, "delete");
  }

  return rows.map((row) => row.id);
}

function applyEntryChange(db: Database, change: EntryChange): ApplyChangeResult {
  if (change.action === "delete") {
    db.prepare("DELETE FROM time_entries WHERE id = ?").run(change.recordId);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run("time_entries", change.recordId, change.timestamp);
    return result(change, "applied", "deleted entry");
  }

  const data: TimeEntry = change.data;

  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(data.categoryId);
  // 分类不存在时 skip（可能是顺序依赖尚未应用），路由层会将 skipped 映射为 conflict/server_version_newer_or_same。
  if (!category) return result(change, "skipped", "missing category", undefined, undefined, "missing_category");

  const overriddenRecordIds = deleteOverlappingEntries(db, data, change.timestamp);
  const existing = db.prepare("SELECT updated_at FROM time_entries WHERE id = ?").get(change.recordId) as
    | Pick<EntryRow, "updated_at">
    | undefined;

  // 服务端用 syncLog 时间作为 updated_at，避免 payload.updatedAt 受客户端时钟漂移影响。
  if (existing) {
    db.prepare(`
      UPDATE time_entries SET category_id = ?, start_time = ?, end_time = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(data.categoryId, data.startTime, data.endTime, data.note, change.timestamp, change.recordId);
    return result(change, "applied", "updated entry", existing.updated_at, overriddenRecordIds);
  }

  db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.id, data.categoryId, data.startTime, data.endTime, data.note, data.createdAt, change.timestamp);
  return result(change, "applied", "inserted entry", undefined, overriddenRecordIds);
}

function result(
  change: SyncChange,
  status: ApplyChangeResult["status"],
  reason: string,
  serverUpdatedAt?: string,
  overriddenRecordIds?: string[],
  skipReason?: ApplyChangeResult["skipReason"],
): ApplyChangeResult {
  return {
    recordId: change.recordId,
    tableName: change.tableName,
    action: change.action,
    status,
    reason,
    serverUpdatedAt,
    incomingTimestamp: change.timestamp,
    overriddenRecordIds,
    skipReason,
  };
}
