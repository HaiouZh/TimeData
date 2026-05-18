import Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, vi } from "vitest";

export async function setupRouteTestApp(
  routePath: string,
  routeModulePath: string,
): Promise<{ app: Hono; db: Database.Database }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => ":memory:" }));

  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();

  const { Hono } = await import("hono");
  const route = (await import(routeModulePath)).default;
  const app = new Hono().route(routePath, route);

  return { app, db };
}

export function cleanupRouteTestDb(db: Database.Database): void {
  db.close();
  vi.doUnmock("../db/connection.js");
}

export function seedCategory(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    name: string;
    parentId: string | null;
    color: string;
    icon: string | null;
    sortOrder: number;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
  }> = {},
): string {
  const id = overrides.id ?? `cat-${Math.random().toString(36).slice(2)}`;
  const timestamp = overrides.createdAt ?? "2026-05-13T08:00:00.000Z";
  db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? id,
    overrides.parentId ?? null,
    overrides.color ?? "#4A90D9",
    overrides.icon ?? null,
    overrides.sortOrder ?? 0,
    overrides.isArchived ? 1 : 0,
    timestamp,
    overrides.updatedAt ?? timestamp,
  );
  return id;
}

export function seedEntry(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    categoryId: string;
    startTime: string;
    endTime: string;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {},
): string {
  const id = overrides.id ?? `entry-${Math.random().toString(36).slice(2)}`;
  const timestamp = overrides.createdAt ?? "2026-05-13T08:00:00.000Z";
  db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.categoryId ?? "cat-sleep",
    overrides.startTime ?? "2026-05-13T09:00:00.000Z",
    overrides.endTime ?? "2026-05-13T10:00:00.000Z",
    overrides.note ?? null,
    timestamp,
    overrides.updatedAt ?? timestamp,
  );
  return id;
}

afterEach(() => {
  vi.restoreAllMocks();
});
