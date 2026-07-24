import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_SYNC_DOMAINS, getServerDomain } from "./domains.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-domains-test-"));
const dbPath = path.join(tempRoot, "timedata.db");

vi.stubEnv("DB_PATH", dbPath);

const { getDb } = await import("../db/connection.js");
const { initializeDatabase } = await import("../db/schema.js");

beforeEach(() => {
  initializeDatabase();
  getDb().exec("DELETE FROM sync_logs; DELETE FROM sync_tombstones; DELETE FROM time_entries; DELETE FROM categories;");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server sync domains", () => {
  it("covers every registered shared domain", () => {
    expect(Object.keys(SERVER_SYNC_DOMAINS).sort()).toEqual([
      "categories",
      "goal_layout_pins",
      "goals",
      "health_charts",
      "health_heart_rate",
      "health_hrv",
      "health_sleep",
      "health_stress",
      "quick_notes",
      "runs",
      "sessions",
      "settings",
      "tasks",
      "time_entries",
      "track_steps",
      "tracks",
    ]);
  });

  it("lww domains have no custom apply hook (use generic path)", () => {
    expect(getServerDomain("settings").apply).toBeUndefined();
    expect(getServerDomain("quick_notes").apply).toBeUndefined();
    expect(getServerDomain("settings").lww).toBeDefined();
    expect(getServerDomain("quick_notes").lww).toBeDefined();
  });

  it("registers health_charts on the generic lww path", () => {
    expect(getServerDomain("health_charts").apply).toBeUndefined();
    expect(getServerDomain("health_charts").lww).toBeDefined();
  });

  it("registers tracks and track_steps on the generic lww path", () => {
    expect(getServerDomain("tracks").apply).toBeUndefined();
    expect(getServerDomain("track_steps").apply).toBeUndefined();
    expect(getServerDomain("tracks").lww).toBeDefined();
    expect(getServerDomain("track_steps").lww).toBeDefined();
  });

  it("registers goals on the generic lww path", () => {
    const domain = getServerDomain("goals");
    expect(domain.apply).toBeUndefined();
    expect(domain.lww).toEqual(expect.objectContaining({ idColumn: "id" }));
  });

  it("registers goal_layout_pins with composite-key hooks", () => {
    const domain = getServerDomain("goal_layout_pins");

    expect(domain.identity).toBeTypeOf("function");
    expect(domain.validate).toBeTypeOf("function");
    expect(domain.apply).toBeTypeOf("function");
    expect(domain.readRecord).toBeTypeOf("function");
    expect(domain.lww).toBeUndefined();
  });

  it("complex domains keep custom hooks", () => {
    expect(getServerDomain("time_entries").apply).toBeTypeOf("function");
    expect(getServerDomain("categories").apply).toBeTypeOf("function");
    expect(getServerDomain("time_entries").validate).toBeTypeOf("function");
    expect(getServerDomain("categories").validate).toBeTypeOf("function");
    expect(getServerDomain("time_entries").crossValidate).toBeTypeOf("function");
  });

  it("throws on unknown domain", () => {
    expect(() => getServerDomain("nope")).toThrow(/Unknown server sync domain/);
  });
});

describe("time entry overlap prediction", () => {
  it("predicts overlapping deletions without mutating", async () => {
    const { findOverlappingEntryIds, predictChangeImpactRecords, predictOverlappingDeletions } =
      await import("./domains.js");
    const db = getDb();
    db.prepare(
      "INSERT INTO categories (id,name,parent_id,color,icon,sort_order,is_archived,created_at,updated_at) VALUES ('c','c',NULL,'#808080',NULL,0,0,?,?)",
    ).run("2026-06-30T00:00:00.000Z", "2026-06-30T00:00:00.000Z");
    db.prepare(
      "INSERT INTO time_entries (id,category_id,start_time,end_time,note,created_at,updated_at) VALUES ('e1','c',?,?,NULL,?,?)",
    ).run(
      "2026-06-30T09:00:00.000Z",
      "2026-06-30T10:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    );

    const incoming = {
      id: "e2",
      categoryId: "c",
      startTime: "2026-06-30T09:30:00.000Z",
      endTime: "2026-06-30T10:30:00.000Z",
      createdAt: "2026-06-30T00:00:00.000Z",
      note: null,
    };
    expect(findOverlappingEntryIds(db, incoming as never)).toEqual(["e1"]);

    const changes = [
      {
        tableName: "time_entries",
        recordId: "e2",
        action: "create",
        data: incoming,
        timestamp: "2026-06-30T00:00:00.000Z",
      },
    ];
    expect(predictOverlappingDeletions(db, changes as never)).toEqual(["e1"]);
    expect(predictChangeImpactRecords(db, changes[0] as never)).toEqual([
      { tableName: "time_entries", recordId: "e2" },
      { tableName: "time_entries", recordId: "e1" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS c FROM time_entries").get()).toEqual({ c: 1 });
  });
});

describe("push impact expansion", () => {
  it("expands a parent category delete to descendants and their entries without mutating", async () => {
    const { predictChangeImpactRecords } = await import("./domains.js");
    const db = getDb();
    const timestamp = "2026-07-10T00:00:00.000Z";
    db.prepare(
      "INSERT INTO categories (id,name,parent_id,color,icon,sort_order,is_archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("parent", "父分类", null, "#808080", null, 0, 0, timestamp, timestamp);
    db.prepare(
      "INSERT INTO categories (id,name,parent_id,color,icon,sort_order,is_archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("child", "子分类", "parent", "#808080", null, 0, 0, timestamp, timestamp);
    db.prepare(
      "INSERT INTO time_entries (id,category_id,start_time,end_time,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "child-entry",
      "child",
      "2026-07-10T01:00:00.000Z",
      "2026-07-10T02:00:00.000Z",
      null,
      timestamp,
      timestamp,
    );

    const impacts = predictChangeImpactRecords(db, {
      tableName: "categories",
      recordId: "parent",
      action: "delete",
      data: null,
      timestamp,
    } as never);

    expect(impacts).toEqual([
      { tableName: "categories", recordId: "parent" },
      { tableName: "categories", recordId: "child" },
      { tableName: "time_entries", recordId: "child-entry" },
    ]);
    expect(db.prepare("SELECT id FROM categories ORDER BY id").all()).toEqual([{ id: "child" }, { id: "parent" }]);
    expect(db.prepare("SELECT id FROM time_entries").all()).toEqual([{ id: "child-entry" }]);
  });
});
