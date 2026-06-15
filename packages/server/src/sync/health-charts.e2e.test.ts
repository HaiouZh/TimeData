import { HealthChartConfigSchema, type HealthChartConfig, type SyncChange } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CREATE_NOW = "2026-06-15T12:00:00.000Z";
const DELETE_NOW = "2026-06-15T12:01:00.000Z";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string };
let validateSyncChanges: (db: Database.Database, changes: SyncChange[]) => { valid: boolean };
let orderPushChanges: (changes: SyncChange[]) => SyncChange[];
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{
  id: number;
  tableName: string;
  recordId: string;
  action: string;
}>;
let domains: typeof import("./domains.js");

function metricChart(): HealthChartConfig {
  return {
    id: "chart-1",
    view: "chart",
    source: "healthMetricDaily",
    order: 2,
    title: "健康趋势",
    metricIds: ["hrv.value"],
    chartKind: "line",
    trendMode: "auto",
    rollingWindows: [7],
    showAverageLine: false,
    range: { mode: "inherit" },
    presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  };
}

function chartChange(action: "create" | "delete", data: HealthChartConfig | null): SyncChange {
  return {
    tableName: "health_charts",
    recordId: "chart-1",
    action,
    data,
    timestamp: action === "delete" ? DELETE_NOW : data?.updatedAt ?? CREATE_NOW,
  } as SyncChange;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(CREATE_NOW));
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE health_charts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
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
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.doUnmock("../db/connection.js");
});

describe("health_charts sync roundtrip", () => {
  it("pushes a metricChart, pulls it by seq, and later pulls its tombstone", () => {
    const chart = metricChart();
    const createChange = chartChange("create", chart);

    expect(orderPushChanges([createChange])).toEqual([createChange]);
    expect(validateSyncChanges(db, [createChange]).valid).toBe(true);
    expect(applyChange(createChange)).toMatchObject({ status: "applied" });

    const row = db.prepare("SELECT type, sort_order, updated_at, config FROM health_charts WHERE id = ?").get("chart-1") as {
      type: string;
      sort_order: number;
      updated_at: string;
      config: string;
    };
    expect(row).toMatchObject({ type: "chart", sort_order: 2, updated_at: CREATE_NOW });
    expect(JSON.parse(row.config).metricIds).toEqual(["hrv.value"]);

    const afterCreate = getChangesSinceSeq(null);
    expect(afterCreate).toMatchObject([{ tableName: "health_charts", recordId: "chart-1", action: "create" }]);
    const createSeq = afterCreate[0].id;

    const pulled = domains.SERVER_SYNC_DOMAINS.health_charts.readRecord(db, "chart-1");
    expect(pulled).toMatchObject({
      tableName: "health_charts",
      recordId: "chart-1",
      action: "update",
      timestamp: CREATE_NOW,
      data: { view: "chart", source: "healthMetricDaily", metricIds: ["hrv.value"], updatedAt: CREATE_NOW },
    });
    const pulledConfig = HealthChartConfigSchema.parse(pulled?.data);
    expect(pulledConfig.view).toBe("chart");

    vi.setSystemTime(new Date(DELETE_NOW));
    const deleteChange = chartChange("delete", null);
    expect(validateSyncChanges(db, [deleteChange]).valid).toBe(true);
    expect(applyChange(deleteChange)).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT id FROM health_charts WHERE id = ?").get("chart-1")).toBeUndefined();
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "health_charts",
        "chart-1",
      ),
    ).toMatchObject({ deleted_at: DELETE_NOW });

    expect(getChangesSinceSeq(createSeq)).toMatchObject([
      { tableName: "health_charts", recordId: "chart-1", action: "delete" },
    ]);
  });
});
