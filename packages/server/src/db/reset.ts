import { createDefaultCategories } from "@timedata/shared";
import type Database from "better-sqlite3";
import { computeAndPersistCommitHash } from "../sync/state.js";
import { getDb } from "./connection.js";

export interface ResetDatabaseResult {
  categories: number;
  entriesDeleted: number;
  resetAt: string;
}

export function resetDatabaseConnectionToDefaults(db: Database.Database): ResetDatabaseResult {
  const resetAt = new Date().toISOString();
  const resetAll = db.transaction(() => {
    const before = db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as { count: number };

    db.prepare("DELETE FROM track_steps").run();
    db.prepare("DELETE FROM tracks").run();
    db.prepare("DELETE FROM goal_layout_pins").run();
    db.prepare("DELETE FROM quick_notes").run();
    db.prepare("DELETE FROM time_entries").run();
    db.prepare("DELETE FROM settings").run();
    db.prepare("DELETE FROM sync_logs").run();
    db.prepare("DELETE FROM sync_tombstones").run();
    db.prepare("DELETE FROM sync_seq").run();
    db.prepare("DELETE FROM categories WHERE parent_id IS NOT NULL").run();
    db.prepare("DELETE FROM categories WHERE parent_id IS NULL").run();
    const categories = insertDefaultCategories(db, resetAt);
    computeAndPersistCommitHash(db);

    return {
      categories,
      entriesDeleted: before.count,
      resetAt,
    };
  });

  return resetAll();
}

export function insertDefaultCategories(db: Database.Database, timestamp = new Date().toISOString()): number {
  const categories = createDefaultCategories(timestamp);
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

  return categories.length;
}

export function resetDatabaseToDefaults(): ResetDatabaseResult {
  return resetDatabaseConnectionToDefaults(getDb());
}
