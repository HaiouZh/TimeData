import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCommitHash } from "../sync/state.js";
import {
  createEntryFromCliInput,
  listCategoryPaths,
  listEntriesForCliDate,
  resolveCategoryPath,
} from "./entry-service.js";

let db: Database.Database;

function createSchema() {
  db.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT NOT NULL DEFAULT '#808080',
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );

    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quick_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      last_done_at TEXT,
      start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE track_steps (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_label TEXT,
      content TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      refs TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT, members TEXT NOT NULL DEFAULT '[]', prerequisites TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS goal_layout_pins (
      goal_id TEXT NOT NULL,
      node_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, node_kind, node_id)
    );

    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_heart_rate (id TEXT PRIMARY KEY, date TEXT NOT NULL, resting_heart_rate INTEGER, min_heart_rate INTEGER, max_heart_rate INTEGER, avg_heart_rate INTEGER, last_7_days_avg_resting_heart_rate INTEGER, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_hrv (id TEXT PRIMARY KEY, date TEXT NOT NULL, hrv_ms INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_sleep (id TEXT PRIMARY KEY, date TEXT NOT NULL, sleep_start TEXT NOT NULL, wake_time TEXT NOT NULL, adjustment_hours INTEGER NOT NULL DEFAULT 0, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_stress (id TEXT PRIMARY KEY, date TEXT NOT NULL, stress INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, distance_km REAL, duration_seconds INTEGER, average_heart_rate INTEGER, average_cadence REAL, average_stride_m REAL, average_vertical_ratio_percent REAL, average_vertical_oscillation_cm REAL, average_ground_contact_ms INTEGER, type TEXT NOT NULL, city TEXT NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_charts (id TEXT PRIMARY KEY, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

  `);
}

function seedCategories() {
  const now = "2026-05-07T00:00:00.000Z";
  db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run("cat-work", "工作", null, "#4A90D9", 0, 0, now, now);
  db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run("cat-code", "编程", "cat-work", "#4A90D9", 0, 0, now, now);
  db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run("cat-archived", "旧项目", "cat-work", "#4A90D9", 1, 1, now, now);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema();
  seedCategories();
});

afterEach(() => {
  db.close();
});

describe("entry service", () => {
  it("lists non-archived category paths accepted by the CLI", () => {
    expect(listCategoryPaths(db)).toEqual([
      { id: "cat-work", path: "工作", name: "工作", parentId: null },
      { id: "cat-code", path: "工作/编程", name: "编程", parentId: "cat-work" },
    ]);
  });

  it("resolves a unique non-archived category path", () => {
    expect(resolveCategoryPath(db, "工作/编程")).toEqual({ ok: true, categoryId: "cat-code" });
  });

  it("rejects missing and archived category paths", () => {
    expect(resolveCategoryPath(db, "工作/不存在")).toEqual({ ok: false, code: "CATEGORY_NOT_FOUND" });
    expect(resolveCategoryPath(db, "工作/旧项目")).toEqual({ ok: false, code: "CATEGORY_NOT_FOUND" });
  });

  it("returns CLI list response with category paths and summary", () => {
    const now = "2026-05-07T09:00:00.000Z";
    // 上海 09:00 = UTC 01:00，上海 10:30 = UTC 02:30
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES ('entry-1', 'cat-code', '2026-05-07T01:00:00.000Z', '2026-05-07T02:30:00.000Z', '修复同步', ?, ?)
    `).run(now, now);

    expect(listEntriesForCliDate(db, "2026-05-07")).toEqual({
      ok: true,
      date: "2026-05-07",
      entries: [
        {
          id: "entry-1",
          startTime: "2026-05-07T09:00:00",
          endTime: "2026-05-07T10:30:00",
          durationMinutes: 90,
          category: "工作/编程",
          note: "修复同步",
        },
      ],
      summary: { totalMinutes: 90, entryCount: 1 },
    });
  });

  it("uses half-open day bounds for CLI list response", () => {
    const now = "2026-05-07T09:00:00.000Z";
    // previous-day-entry: 上海 05-06 23:00–00:00 = UTC 05-06 15:00–16:00
    // 查询 2026-05-07 的 UTC 边界：05-06T16:00Z ~ 05-07T16:00Z
    // previous-day-entry end=05-06T16:00Z，不满足 end > dayStartUtc（等于不算），故不被选中
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES ('previous-day-entry', 'cat-code', '2026-05-06T15:00:00.000Z', '2026-05-06T16:00:00.000Z', NULL, ?, ?)
    `).run(now, now);
    // current-day-entry: 上海 05-07 23:00–08T00:00 = UTC 05-07 15:00–16:00
    // 满足：start < 05-07T16:00Z AND end > 05-06T16:00Z
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES ('current-day-entry', 'cat-code', '2026-05-07T15:00:00.000Z', '2026-05-07T16:00:00.000Z', NULL, ?, ?)
    `).run(now, now);

    const result = listEntriesForCliDate(db, "2026-05-07");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.entries.map((entry) => entry.id)).toEqual(["current-day-entry"]);
  });

  it("creates a non-overlapping CLI entry", () => {
    const result = createEntryFromCliInput(db, {
      date: "2026-05-07",
      start: "14:00",
      end: "16:00",
      category: "工作/编程",
      note: "重构同步模块",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.entry.date).toBe("2026-05-07");
    expect(result.entry.category).toBe("工作/编程");

    const row = db
      .prepare("SELECT category_id, start_time, end_time, note FROM time_entries WHERE id = ?")
      .get(result.entry.id);
    // 上海 14:00 = UTC 06:00，上海 16:00 = UTC 08:00
    expect(row).toEqual({
      category_id: "cat-code",
      start_time: "2026-05-07T06:00:00.000Z",
      end_time: "2026-05-07T08:00:00.000Z",
      note: "重构同步模块",
    });
  });

  it("rejects CLI entries whose end time is in the future", () => {
    const result = createEntryFromCliInput(
      db,
      {
        date: "2026-05-07",
        start: "14:00",
        end: "16:00",
        category: "工作/编程",
        note: "未来记录",
      },
      { now: new Date("2026-05-07T15:59:00+08:00") },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_TIME_RANGE",
        message: "End time cannot be in the future",
      },
    });

    const count = db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("allows CLI entries ending exactly at the current time", () => {
    const result = createEntryFromCliInput(
      db,
      {
        date: "2026-05-07",
        start: "14:00",
        end: "16:00",
        category: "工作/编程",
        note: "当前记录",
      },
      { now: new Date("2026-05-07T16:00:00+08:00") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.entry.endTime).toBe("2026-05-07T16:00:00");
  });

  it("uses the injected current time for created_at and updated_at", () => {
    const now = new Date("2026-05-07T16:00:00+08:00");
    const result = createEntryFromCliInput(
      db,
      {
        date: "2026-05-07",
        start: "14:00",
        end: "16:00",
        category: "工作/编程",
        note: "当前记录",
      },
      { now },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const row = db.prepare("SELECT created_at, updated_at FROM time_entries WHERE id = ?").get(result.entry.id);
    expect(row).toEqual({ created_at: now.toISOString(), updated_at: now.toISOString() });
  });

  it("records sync_seq and refreshes sync state when creating an entry from CLI input", () => {
    const before = getCommitHash(db).hash;
    const result = createEntryFromCliInput(
      db,
      {
        date: "2026-05-07",
        start: "14:00",
        end: "16:00",
        category: "工作/编程",
        note: "CLI 写入",
      },
      { now: new Date("2026-05-07T16:00:00+08:00") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const seq = db
      .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE record_id = ?")
      .get(result.entry.id);
    expect(seq).toEqual({ table_name: "time_entries", record_id: result.entry.id, action: "create" });
    expect(getCommitHash(db).hash).not.toBe(before);
  });
});

// ── Task 4: UTC storage ──────────────────────────────────────────────────────

function makeDb2() {
  const db2 = new Database(":memory:");
  db2.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
      color TEXT NOT NULL DEFAULT '#808080', icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE quick_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      last_done_at TEXT,
      start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE track_steps (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_label TEXT,
      content TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      refs TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_heart_rate (id TEXT PRIMARY KEY, date TEXT NOT NULL, resting_heart_rate INTEGER, min_heart_rate INTEGER, max_heart_rate INTEGER, avg_heart_rate INTEGER, last_7_days_avg_resting_heart_rate INTEGER, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_hrv (id TEXT PRIMARY KEY, date TEXT NOT NULL, hrv_ms INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_sleep (id TEXT PRIMARY KEY, date TEXT NOT NULL, sleep_start TEXT NOT NULL, wake_time TEXT NOT NULL, adjustment_hours INTEGER NOT NULL DEFAULT 0, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_stress (id TEXT PRIMARY KEY, date TEXT NOT NULL, stress INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, distance_km REAL, duration_seconds INTEGER, average_heart_rate INTEGER, average_cadence REAL, average_stride_m REAL, average_vertical_ratio_percent REAL, average_vertical_oscillation_cm REAL, average_ground_contact_ms INTEGER, type TEXT NOT NULL, city TEXT NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_charts (id TEXT PRIMARY KEY, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    INSERT INTO categories VALUES ('cat1','Work/Dev',null,'#ff0000',null,0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
  `);
  return db2;
}

describe("createEntryFromCliInput — UTC storage", () => {
  it("stores start_time and end_time as UTC ISO strings", () => {
    const db2 = makeDb2();
    const result = createEntryFromCliInput(
      db2,
      {
        date: "2026-05-14",
        start: "15:00",
        end: "16:00",
        category: "Work/Dev",
      },
      { now: new Date("2026-05-14T16:00:00+08:00") },
    );

    expect(result.ok).toBe(true);
    const row = db2.prepare("SELECT start_time, end_time FROM time_entries LIMIT 1").get() as {
      start_time: string;
      end_time: string;
    };
    // 上海 15:00 = UTC 07:00
    expect(row.start_time).toBe("2026-05-14T07:00:00.000Z");
    expect(row.end_time).toBe("2026-05-14T08:00:00.000Z");
    db2.close();
  });

  it("returns startTime/endTime in local time for CLI display", () => {
    const db2 = makeDb2();
    const result = createEntryFromCliInput(
      db2,
      {
        date: "2026-05-14",
        start: "09:00",
        end: "10:00",
        category: "Work/Dev",
      },
      { now: new Date("2026-05-14T10:00:00+08:00") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.entry.startTime).toBe("2026-05-14T09:00:00");
    expect(result.entry.endTime).toBe("2026-05-14T10:00:00");
    db2.close();
  });
});

describe("listEntriesForCliDate — UTC storage", () => {
  it("returns entries that fall on the given local date, with local display time", () => {
    const db2 = makeDb2();
    // 直接写入 UTC 数据
    db2
      .prepare(
        "INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "e1",
        "cat1",
        "2026-05-14T07:00:00.000Z",
        "2026-05-14T08:00:00.000Z",
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const result = listEntriesForCliDate(db2, "2026-05-14");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.entries).toHaveLength(1);
    // CLI 展示应为本地时间
    expect(result.entries[0].startTime).toBe("2026-05-14T15:00:00");
    expect(result.entries[0].endTime).toBe("2026-05-14T16:00:00");
    db2.close();
  });
});
