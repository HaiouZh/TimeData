import type { SyncChange, SyncDomainConfig } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// “新域白捡同步”验收测试：注册一个零钩子 LWW 假域 test_items，
// 验证它不写一行同步代码就走完 校验 → 排序 → 写入 → 记账 → seq 补差 → 删除墓碑 全链路。

const TestItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  updatedAt: z.string(),
});

const fakeSharedDomain: SyncDomainConfig = {
  table: "test_items",
  dataSchema: TestItemSchema,
  upsertPriority: 45,
  deletePriority: 45,
  conflictPolicy: "lww",
  countsInStatus: false,
};

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string };
let validateSyncChanges: (
  db: Database.Database,
  changes: SyncChange[],
  options?: Record<string, unknown>,
  registry?: readonly SyncDomainConfig[],
) => { valid: boolean };
let orderPushChanges: (changes: SyncChange[], registry?: readonly SyncDomainConfig[]) => SyncChange[];
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{ id: number; tableName: string; recordId: string; action: string }>;
let domains: typeof import("./domains.js");
// 测试注册表 = 真实登记簿 + 假域，经注入参数传给纯函数（vitest 下 shared 会出现双实例，不能靠改模块单例）。
let testRegistry: SyncDomainConfig[];

function change(action: "create" | "update" | "delete", id: string, text?: string): SyncChange {
  return {
    tableName: "test_items",
    recordId: id,
    action,
    data: action === "delete" ? null : { id, text, updatedAt: "2026-06-13T00:00:00.000Z" },
    timestamp: "2026-06-13T00:00:00.000Z",
  } as unknown as SyncChange;
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE test_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
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


    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  domains = await import("./domains.js");
  ({ applyChange } = await import("./resolver.js"));
  ({ validateSyncChanges } = await import("./validation.js"));
  ({ orderPushChanges } = await import("./order.js"));
  ({ getChangesSinceSeq } = await import("./seq.js"));
  const shared = await import("@timedata/shared");

  // 注册假域：shared 配置一行 + server 端 LWW 映射 / readRecord，没有任何自定义钩子。
  testRegistry = [...shared.SYNC_DOMAINS, fakeSharedDomain];
  domains.SERVER_SYNC_DOMAINS.test_items = {
    lww: {
      idColumn: "id",
      toRow: (data) => {
        const item = data as z.infer<typeof TestItemSchema>;
        return { id: item.id, text: item.text };
      },
    },
    readRecord: (database, recordId) => {
      const row = database.prepare("SELECT * FROM test_items WHERE id = ?").get(recordId) as
        | { id: string; text: string; updated_at: string }
        | undefined;
      if (!row) return null;
      return {
        tableName: "test_items",
        recordId: row.id,
        action: "update",
        data: { id: row.id, text: row.text, updatedAt: row.updated_at },
        timestamp: row.updated_at,
      } as unknown as SyncChange;
    },
  };
});

afterEach(() => {
  Reflect.deleteProperty(domains.SERVER_SYNC_DOMAINS, "test_items");
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("fake LWW domain rides the full sync pipeline with zero hooks", () => {
  it("create → ledger → seq pull → update → delete → tombstone pull", () => {
    // 1. push 校验 + 排序 + 写入
    const createChange = change("create", "item-1", "hello ledger");
    expect(orderPushChanges([createChange], testRegistry)).toEqual([createChange]);
    expect(validateSyncChanges(db, [createChange], {}, testRegistry).valid).toBe(true);
    expect(applyChange(createChange)).toMatchObject({ status: "applied" });

    // 2. 写入即记账
    const afterCreate = getChangesSinceSeq(null);
    expect(afterCreate).toMatchObject([{ tableName: "test_items", recordId: "item-1", action: "create" }]);
    const createSeq = afterCreate[0].id;

    // 3. seq 补差读到当前行
    const pulled = domains.SERVER_SYNC_DOMAINS.test_items.readRecord(db, "item-1");
    expect(pulled).toMatchObject({ tableName: "test_items", recordId: "item-1", data: { text: "hello ledger" } });

    // 4. update 走同一条通用路径
    const updateChange = change("update", "item-1", "hello again");
    expect(validateSyncChanges(db, [updateChange], {}, testRegistry).valid).toBe(true);
    expect(applyChange(updateChange)).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT text FROM test_items WHERE id = ?").get("item-1")).toMatchObject({ text: "hello again" });

    // 5. delete → 真删除 + 墓碑 + 记账
    const deleteChange = change("delete", "item-1");
    expect(validateSyncChanges(db, [deleteChange], {}, testRegistry).valid).toBe(true);
    expect(applyChange(deleteChange)).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT id FROM test_items WHERE id = ?").get("item-1")).toBeUndefined();
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'test_items' AND record_id = ?").get("item-1"),
    ).toBeDefined();

    // 6. 老读数的设备补差时，最终只看到 delete
    const catchUp = getChangesSinceSeq(createSeq);
    expect(catchUp).toMatchObject([{ tableName: "test_items", recordId: "item-1", action: "delete" }]);
  });

  it("rejects payloads failing the registered schema with no custom validator", () => {
    const bad = {
      tableName: "test_items",
      recordId: "item-bad",
      action: "create",
      data: { id: "item-bad", text: "", updatedAt: "2026-06-13T00:00:00.000Z" },
      timestamp: "2026-06-13T00:00:00.000Z",
    } as unknown as SyncChange;
    expect(validateSyncChanges(db, [bad], {}, testRegistry).valid).toBe(false);
  });

  it("keeps the registry closed: unregistered tables are rejected", () => {
    const unknown = {
      tableName: "not_registered",
      recordId: "x",
      action: "create",
      data: { id: "x" },
      timestamp: "2026-06-13T00:00:00.000Z",
    } as unknown as SyncChange;
    expect(validateSyncChanges(db, [unknown], {}, testRegistry).valid).toBe(false);
  });
});
