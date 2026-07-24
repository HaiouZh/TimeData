import {
  SYNC_DOMAINS,
  createDefaultCategories,
  encodeGoalLayoutPinKey,
  type Category,
  type GoalLayoutPinNodeKind,
} from "@timedata/shared";
import type Database from "better-sqlite3";
import { recordSeqWithDb } from "../sync/seq.js";
import { computeAndPersistCommitHash } from "../sync/state.js";
import { getDb } from "./connection.js";

export interface ResetDatabaseResult {
  categories: number;
  entriesDeleted: number;
  resetAt: string;
}

interface ResetDomainSpec {
  tableName: string;
  selectRecordIds: (db: Database.Database) => string[];
}

function simpleDomain(tableName: string, idColumn = "id"): ResetDomainSpec {
  return {
    tableName,
    selectRecordIds: (db) => {
      const rows = db
        .prepare(`SELECT ${idColumn} AS record_id FROM ${tableName} ORDER BY ${idColumn}`)
        .all() as Array<{ record_id: string }>;
      return rows.map((row) => row.record_id);
    },
  };
}

// 顺序同时用于删除与 delete seq：先删依赖方，再删被依赖方。
const RESET_DOMAIN_SPECS: readonly ResetDomainSpec[] = [
  {
    tableName: "goal_layout_pins",
    selectRecordIds: (db) => {
      const rows = db
        .prepare("SELECT goal_id, node_kind, node_id FROM goal_layout_pins ORDER BY goal_id, node_kind, node_id")
        .all() as Array<{ goal_id: string; node_kind: GoalLayoutPinNodeKind; node_id: string }>;
      return rows.map((row) => encodeGoalLayoutPinKey(row.goal_id, row.node_kind, row.node_id));
    },
  },
  simpleDomain("goals"),
  simpleDomain("track_steps"),
  simpleDomain("tracks"),
  simpleDomain("time_entries"),
  simpleDomain("tasks"),
  simpleDomain("sessions"),
  simpleDomain("quick_notes"),
  simpleDomain("settings", "key"),
  simpleDomain("health_charts"),
  simpleDomain("health_heart_rate"),
  simpleDomain("health_hrv"),
  simpleDomain("health_sleep"),
  simpleDomain("health_stress"),
  simpleDomain("runs"),
  {
    tableName: "categories",
    selectRecordIds: (db) => {
      const rows = db
        .prepare(`
          SELECT id AS record_id
          FROM categories
          ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, id
        `)
        .all() as Array<{ record_id: string }>;
      return rows.map((row) => row.record_id);
    },
  },
];

const RESET_SEQ_SPECS: readonly ResetDomainSpec[] = [
  RESET_DOMAIN_SPECS[RESET_DOMAIN_SPECS.length - 1],
  ...RESET_DOMAIN_SPECS.slice(0, -1),
];

function assertResetDomainCoverage(): void {
  const registered = new Set(SYNC_DOMAINS.map((domain) => domain.table));
  const resettable = new Set(RESET_DOMAIN_SPECS.map((domain) => domain.tableName));
  const missing = [...registered].filter((table) => !resettable.has(table));
  const extra = [...resettable].filter((table) => !registered.has(table));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Reset domain registry mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
}

function insertCategories(db: Database.Database, categories: Category[]): void {
  const insert = db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const category of categories) {
    insert.run(
      category.id,
      category.name,
      category.parentId,
      category.color,
      category.icon,
      category.sortOrder,
      category.isArchived ? 1 : 0,
      category.createdAt,
      category.updatedAt,
    );
  }
}

export function resetDatabaseConnectionToDefaultsInTransaction(
  db: Database.Database,
  resetAt: string,
): ResetDatabaseResult {
  assertResetDomainCoverage();
  const entriesBefore = db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as { count: number };
  const recordsByTable = new Map(
    RESET_DOMAIN_SPECS.map((domain) => [domain.tableName, domain.selectRecordIds(db)]),
  );
  const existingCategoryIds = new Set(recordsByTable.get("categories") ?? []);

  for (const domain of RESET_DOMAIN_SPECS) {
    db.prepare(`DELETE FROM ${domain.tableName}`).run();
  }
  db.prepare("DELETE FROM sync_logs").run();

  const upsertTombstone = db.prepare(`
    INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
  `);
  for (const domain of RESET_SEQ_SPECS) {
    for (const recordId of recordsByTable.get(domain.tableName) ?? []) {
      upsertTombstone.run(domain.tableName, recordId, resetAt);
      recordSeqWithDb(db, domain.tableName, recordId, "delete");
    }
  }

  const defaultCategories = createDefaultCategories(resetAt);
  insertCategories(db, defaultCategories);
  const clearCategoryTombstone = db.prepare(
    "DELETE FROM sync_tombstones WHERE table_name = 'categories' AND record_id = ?",
  );
  for (const category of defaultCategories) {
    clearCategoryTombstone.run(category.id);
    recordSeqWithDb(db, "categories", category.id, existingCategoryIds.has(category.id) ? "update" : "create");
  }

  computeAndPersistCommitHash(db);
  return {
    categories: defaultCategories.length,
    entriesDeleted: entriesBefore.count,
    resetAt,
  };
}

export function resetDatabaseConnectionToDefaults(db: Database.Database): ResetDatabaseResult {
  const resetAt = new Date().toISOString();
  return db.transaction(() => resetDatabaseConnectionToDefaultsInTransaction(db, resetAt))();
}

export function insertDefaultCategories(db: Database.Database, timestamp = new Date().toISOString()): number {
  const categories = createDefaultCategories(timestamp);
  insertCategories(db, categories);
  return categories.length;
}

export function resetDatabaseToDefaults(): ResetDatabaseResult {
  return resetDatabaseConnectionToDefaults(getDb());
}
