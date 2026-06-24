import {
  decodeGoalLayoutPinKey,
  encodeGoalLayoutPinKey,
  type Category,
  type GoalLayoutPin,
  type QuickNote,
  type Setting,
  type SyncChange,
  type SyncPushOutcome,
  type Task,
  type TimeEntry,
} from "@timedata/shared";
import type { Database } from "better-sqlite3";
import {
  type CategoryRow,
  type EntryRow,
  type QuickNoteRow,
  type SettingRow,
  type TaskRow,
  rowToCategory,
  rowToEntry,
  rowToQuickNote,
  rowToSetting,
  rowToTask,
} from "../lib/db-rows.js";
import {
  type HealthHeartRateRow, type HealthHrvRow, type HealthSleepRow,
  type HealthStressRow, type HealthRunRow,
  rowToHealthHeartRate, rowToHealthHrv, rowToHealthSleep,
  rowToHealthStress, rowToHealthRun,
  healthHeartRateToRow, healthHrvToRow, healthSleepToRow,
  healthStressToRow, healthRunToRow,
} from "../lib/healthRows.js";
import { type HealthChartRow, rowToHealthChart, healthChartToRow } from "../lib/chartRows.js";
import { type GoalRow, goalToRow, rowToGoal } from "../lib/goal-rows.js";
import {
  type GoalLayoutPinRow,
  goalLayoutPinToRow,
  rowToGoalLayoutPin,
} from "../lib/goal-layout-pin-rows.js";
import { type TrackRow, type TrackStepRow, rowToTrack, rowToTrackStep, trackStepToRow, trackToRow } from "../lib/track-rows.js";
import { recordSeq } from "./seq.js";

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

export interface ValidateContext {
  batchCategories: Map<string, CategoryParentInfo>;
  now: string;
}

export interface CategoryParentInfo {
  id: string;
  parentId: string | null;
  isArchived: boolean;
}

export interface ServerDomainHooks {
  /** 通用 schema 校验之外的业务校验；返回 null 表示通过 */
  validate?: (db: Database, change: SyncChange, ctx: ValidateContext) => SyncPushOutcome | null;
  /** 同批次跨记录校验（如 entries 互相重叠）；返回 null 表示通过 */
  crossValidate?: (change: SyncChange, previousChanges: SyncChange[]) => SyncPushOutcome | null;
  /** 自定义写入；缺省走通用 LWW upsert/delete + tombstone */
  apply?: (db: Database, change: SyncChange, serverNow: string) => ApplyChangeResult;
  /** 从 upsert payload 计算 sync recordId；复合键域用它替代 payload.id。 */
  identity?: (data: unknown) => string;
  /** 通用 LWW 路径所需的表/主键列映射（apply 缺省时必填） */
  lww?: { idColumn: string; toRow: (data: unknown) => Record<string, string | number | null> };
  /** 按主键读当前行并转成 update SyncChange；pull seq 补差用，行不存在返回 null */
  readRecord: (db: Database, recordId: string) => SyncChange | null;
}

export function changeOutcome(
  change: SyncChange,
  status: SyncPushOutcome["status"],
  reasonCode: SyncPushOutcome["reasonCode"],
  message: string,
  serverUpdatedAt?: string,
): SyncPushOutcome {
  return {
    tableName: change.tableName,
    recordId: change.recordId,
    action: change.action,
    status,
    reasonCode,
    message,
    incomingTimestamp: change.timestamp,
    serverUpdatedAt,
  };
}

export function applyResult(
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

export function getCategoryParentInfo(
  db: Database,
  batchCategories: Map<string, CategoryParentInfo>,
  id: string,
): CategoryParentInfo | null {
  const batch = batchCategories.get(id);
  if (batch) return batch;

  const row = db.prepare("SELECT id, parent_id, is_archived FROM categories WHERE id = ?").get(id) as
    | { id: string; parent_id: string | null; is_archived: number }
    | undefined;
  return row ? { id: row.id, parentId: row.parent_id, isArchived: Boolean(row.is_archived) } : null;
}

// ---- categories 域钩子 ----

function validateCategoryChange(db: Database, change: SyncChange, ctx: ValidateContext): SyncPushOutcome | null {
  if (change.action === "delete") return null;

  const data = change.data as Category;
  if (data.parentId === data.id) {
    return changeOutcome(change, "rejected", "invalid_shape", "category cannot reference itself");
  }

  if (data.parentId) {
    const parent = getCategoryParentInfo(db, ctx.batchCategories, data.parentId);
    if (!parent) return changeOutcome(change, "rejected", "missing_category", "parent category does not exist");
    if (parent.parentId !== null) return changeOutcome(change, "rejected", "invalid_shape", "categories support only two levels");
  }

  return null;
}

function applyCategoryChange(db: Database, change: SyncChange, serverNow: string): ApplyChangeResult {
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
        insertEntryTombstone.run(entry.id, serverNow);
        recordSeq("time_entries", entry.id, "delete");
        cascadedEntryIds.push(entry.id);
      }
      db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
      insertCategoryTombstone.run(categoryId, serverNow);
      recordSeq("categories", categoryId, "delete");
    }

    return applyResult(change, "applied", "deleted category", undefined, cascadedEntryIds);
  }

  const data = change.data as Category;

  const existing = db.prepare("SELECT updated_at FROM categories WHERE id = ?").get(change.recordId) as
    | Pick<CategoryRow, "updated_at">
    | undefined;

  // updated_at 由服务器在记账时分配，客户端时钟（change.timestamp / payload.updatedAt）只作展示参考。
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
      serverNow,
      change.recordId,
    );
    return applyResult(change, "applied", "updated category", existing.updated_at);
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
    serverNow,
  );
  return applyResult(change, "applied", "inserted category");
}

// ---- time_entries 域钩子 ----

function validateEntryChange(db: Database, change: SyncChange, ctx: ValidateContext): SyncPushOutcome | null {
  if (change.action === "delete") return null;

  const data = change.data as TimeEntry;
  if (data.endTime > ctx.now) {
    return changeOutcome(change, "rejected", "invalid_time_range", "entry endTime cannot be in the future");
  }

  const category = getCategoryParentInfo(db, ctx.batchCategories, data.categoryId);
  if (!category) return changeOutcome(change, "rejected", "missing_category", "entry category does not exist");
  if (category.isArchived) return changeOutcome(change, "rejected", "archived_category", "entry category is archived");

  return null;
}

function incomingEntryOverlap(change: SyncChange, previousChanges: SyncChange[]): SyncPushOutcome | null {
  if (change.tableName !== "time_entries" || change.action === "delete" || !change.data) return null;
  const data = change.data as TimeEntry;

  for (const previous of previousChanges) {
    if (previous.tableName !== "time_entries" || previous.action === "delete" || !previous.data) continue;
    const previousData = previous.data as TimeEntry;
    if (previous.recordId === change.recordId) continue;
    if (previousData.startTime < data.endTime && previousData.endTime > data.startTime) {
      return changeOutcome(change, "conflict", "overlap", `incoming entry overlaps another incoming entry ${previous.recordId}`);
    }
  }

  return null;
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

function applyEntryChange(db: Database, change: SyncChange, serverNow: string): ApplyChangeResult {
  if (change.action === "delete") {
    db.prepare("DELETE FROM time_entries WHERE id = ?").run(change.recordId);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run("time_entries", change.recordId, serverNow);
    return applyResult(change, "applied", "deleted entry");
  }

  const data = change.data as TimeEntry;

  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(data.categoryId);
  // 分类不存在时 skip（可能是顺序依赖尚未应用），路由层会将 skipped 映射为 conflict/server_version_newer_or_same。
  if (!category) return applyResult(change, "skipped", "missing category", undefined, undefined, "missing_category");

  const overriddenRecordIds = deleteOverlappingEntries(db, data, serverNow);
  const existing = db.prepare("SELECT updated_at FROM time_entries WHERE id = ?").get(change.recordId) as
    | Pick<EntryRow, "updated_at">
    | undefined;

  // updated_at 由服务器在记账时分配，客户端时钟（change.timestamp / payload.updatedAt）只作展示参考。
  if (existing) {
    db.prepare(`
      UPDATE time_entries SET category_id = ?, start_time = ?, end_time = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(data.categoryId, data.startTime, data.endTime, data.note, serverNow, change.recordId);
    return applyResult(change, "applied", "updated entry", existing.updated_at, overriddenRecordIds);
  }

  db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.id, data.categoryId, data.startTime, data.endTime, data.note, data.createdAt, serverNow);
  return applyResult(change, "applied", "inserted entry", undefined, overriddenRecordIds);
}

// ---- 纯 LWW 域的列映射 ----

function settingToRow(data: unknown): Record<string, string | number | null> {
  const setting = data as Setting;
  return { key: setting.key, value: setting.value };
}

function quickNoteToRow(data: unknown): Record<string, string | number | null> {
  const note = data as QuickNote;
  return {
    id: note.id,
    text: note.text,
    occurred_at: note.occurredAt,
    created_at: note.createdAt,
    source: note.source ?? null,
    source_label: note.sourceLabel ?? null,
    pinned: note.pinned ? 1 : 0,
  };
}

function taskToRow(data: unknown): Record<string, string | number | null> {
  const task = data as Task;
  return {
    id: task.id,
    title: task.title,
    done: task.done ? 1 : 0,
    recurrence: task.recurrence ? JSON.stringify(task.recurrence) : null,
    last_done_at: task.lastDoneAt ?? null,
    start_at: task.startAt ?? null,
    sort_order: task.sortOrder,
    scheduled_at: task.scheduledAt ?? null,
    parent_id: task.parentId ?? null,
    completed_count: task.completedCount ?? 0,
    completed_at: task.completedAt ?? null,
    tags: JSON.stringify(task.tags ?? []),
    created_at: task.createdAt,
  };
}

// ---- pull seq 补差的行读取 ----

function updateChange(tableName: SyncChange["tableName"], recordId: string, data: unknown, timestamp: string): SyncChange {
  return { tableName, recordId, action: "update", data, timestamp } as SyncChange;
}

function readCategoryRecord(db: Database, recordId: string): SyncChange | null {
  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(recordId) as CategoryRow | undefined;
  return row ? updateChange("categories", row.id, rowToCategory(row), row.updated_at) : null;
}

function readEntryRecord(db: Database, recordId: string): SyncChange | null {
  const row = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(recordId) as EntryRow | undefined;
  return row ? updateChange("time_entries", row.id, rowToEntry(row), row.updated_at) : null;
}

function readSettingRecord(db: Database, recordId: string): SyncChange | null {
  const row = db.prepare("SELECT * FROM settings WHERE key = ?").get(recordId) as SettingRow | undefined;
  return row ? updateChange("settings", row.key, rowToSetting(row), row.updated_at) : null;
}

function readQuickNoteRecord(db: Database, recordId: string): SyncChange | null {
  const row = db.prepare("SELECT * FROM quick_notes WHERE id = ?").get(recordId) as QuickNoteRow | undefined;
  return row ? updateChange("quick_notes", row.id, rowToQuickNote(row), row.updated_at) : null;
}

function simpleLwwDomain<Row extends { id: string; updated_at: string }>(
  table: string,
  toRow: (data: unknown) => Record<string, string | number | null>,
  rowToData: (row: Row) => unknown,
): ServerDomainHooks {
  return {
    lww: { idColumn: "id", toRow },
    readRecord: (db: Database, recordId: string): SyncChange | null => {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId) as Row | undefined;
      if (!row) return null;
      return updateChange(table as SyncChange["tableName"], row.id, rowToData(row), row.updated_at);
    },
  };
}

function readTaskRecord(db: Database, recordId: string): SyncChange | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(recordId) as TaskRow | undefined;
  return row ? updateChange("tasks", row.id, rowToTask(row), row.updated_at) : null;
}

function validateGoalLayoutPinChange(_db: Database, change: SyncChange): SyncPushOutcome | null {
  try {
    decodeGoalLayoutPinKey(change.recordId);
    return null;
  } catch (error) {
    return changeOutcome(
      change,
      "rejected",
      "invalid_shape",
      error instanceof Error ? error.message : "invalid goal layout pin key",
    );
  }
}

function applyGoalLayoutPinChange(db: Database, change: SyncChange, serverNow: string): ApplyChangeResult {
  const key = decodeGoalLayoutPinKey(change.recordId);

  if (change.action === "delete") {
    db.prepare(`
      DELETE FROM goal_layout_pins
      WHERE goal_id = ? AND node_kind = ? AND node_id = ?
    `).run(key.goalId, key.nodeKind, key.nodeId);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('goal_layout_pins', ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run(change.recordId, serverNow);
    return applyResult(change, "applied", "deleted goal_layout_pins record");
  }

  const data = change.data as GoalLayoutPin;
  const row = goalLayoutPinToRow(data);
  const existing = db.prepare(`
    SELECT updated_at FROM goal_layout_pins
    WHERE goal_id = ? AND node_kind = ? AND node_id = ?
  `).get(data.goalId, data.nodeKind, data.nodeId) as { updated_at: string } | undefined;

  db.prepare("DELETE FROM sync_tombstones WHERE table_name = 'goal_layout_pins' AND record_id = ?").run(
    change.recordId,
  );
  db.prepare(`
    INSERT INTO goal_layout_pins (goal_id, node_kind, node_id, x, y, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(goal_id, node_kind, node_id)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
  `).run(row.goal_id, row.node_kind, row.node_id, row.x, row.y, serverNow);

  return applyResult(
    change,
    "applied",
    existing ? "updated goal_layout_pins record" : "inserted goal_layout_pins record",
    existing?.updated_at,
  );
}

function readGoalLayoutPinRecord(db: Database, recordId: string): SyncChange | null {
  const key = decodeGoalLayoutPinKey(recordId);
  const row = db.prepare(`
    SELECT * FROM goal_layout_pins
    WHERE goal_id = ? AND node_kind = ? AND node_id = ?
  `).get(key.goalId, key.nodeKind, key.nodeId) as GoalLayoutPinRow | undefined;
  return row ? updateChange("goal_layout_pins", recordId, rowToGoalLayoutPin(row), row.updated_at) : null;
}

export const SERVER_SYNC_DOMAINS: Record<string, ServerDomainHooks> = {
  categories: { validate: validateCategoryChange, apply: applyCategoryChange, readRecord: readCategoryRecord },
  time_entries: {
    validate: validateEntryChange,
    crossValidate: incomingEntryOverlap,
    apply: applyEntryChange,
    readRecord: readEntryRecord,
  },
  settings: { lww: { idColumn: "key", toRow: settingToRow }, readRecord: readSettingRecord },
  quick_notes: { lww: { idColumn: "id", toRow: quickNoteToRow }, readRecord: readQuickNoteRecord },
  tasks: { lww: { idColumn: "id", toRow: taskToRow }, readRecord: readTaskRecord },
  health_heart_rate: simpleLwwDomain<HealthHeartRateRow>("health_heart_rate", healthHeartRateToRow, rowToHealthHeartRate),
  health_hrv: simpleLwwDomain<HealthHrvRow>("health_hrv", healthHrvToRow, rowToHealthHrv),
  health_sleep: simpleLwwDomain<HealthSleepRow>("health_sleep", healthSleepToRow, rowToHealthSleep),
  health_stress: simpleLwwDomain<HealthStressRow>("health_stress", healthStressToRow, rowToHealthStress),
  runs: simpleLwwDomain<HealthRunRow>("runs", healthRunToRow, rowToHealthRun),
  health_charts: simpleLwwDomain<HealthChartRow>("health_charts", healthChartToRow, rowToHealthChart),
  tracks: simpleLwwDomain<TrackRow>("tracks", (data) => trackToRow(data as never), rowToTrack),
  track_steps: simpleLwwDomain<TrackStepRow>("track_steps", (data) => trackStepToRow(data as never), rowToTrackStep),
  goals: simpleLwwDomain<GoalRow>("goals", (data) => goalToRow(data as never), rowToGoal),
  goal_layout_pins: {
    identity: (data) => {
      const pin = data as GoalLayoutPin;
      return encodeGoalLayoutPinKey(pin.goalId, pin.nodeKind, pin.nodeId);
    },
    validate: validateGoalLayoutPinChange,
    apply: applyGoalLayoutPinChange,
    readRecord: readGoalLayoutPinRecord,
  },
};

export function getServerDomain(table: string): ServerDomainHooks {
  const domain = SERVER_SYNC_DOMAINS[table];
  if (!domain) throw new Error(`Unknown server sync domain: ${table}`);
  return domain;
}
