import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import {
  GOAL_PREREQUISITES_SNAPSHOT_KEY,
  LAST_SYNCED_SEQ_KEY,
  db,
  migrateLocalSettingsToDexie,
  resetLocalDataToDefaults,
  resetSyncCursors,
  seedDefaultCategories,
} from "./index.js";

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
});

afterEach(async () => {
  await db.delete();
});

describe("resetLocalDataToDefaults", () => {
  it("clears the quick-note and capture composer draft keys", async () => {
    await db.open();
    localStorage.setItem(STORAGE_KEYS.quickNoteComposerDraft, "打了一半的速记");
    localStorage.setItem(STORAGE_KEYS.captureComposerDraft, "浮窗里没发出去的正文");

    await resetLocalDataToDefaults();

    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.captureComposerDraft)).toBeNull();
  });

  it("clears taskRelations along with the rest of the local data", async () => {
    await db.open();
    await db.taskRelations.add({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await resetLocalDataToDefaults();

    expect(await db.taskRelations.count()).toBe(0);
  });

  it("resetLocalDataToDefaults 不清 migrationSnapshots（迁移底牌必须留下）", async () => {
    await db.open();
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: JSON.stringify({ "g-1": [] }),
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await resetLocalDataToDefaults();

    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(snapshot).toMatchObject({ key: GOAL_PREREQUISITES_SNAPSHOT_KEY });
  });
});

describe("resetSyncCursors", () => {
  it("clears the seq cursor and retired legacy keys", () => {
    localStorage.setItem(LAST_SYNCED_SEQ_KEY, "42");
    localStorage.setItem("timedata_last_synced", "2026-05-07T13:00:00.000Z");
    localStorage.setItem("timedata_legacy_snapshot_sync", "1");

    resetSyncCursors();

    expect(localStorage.getItem(LAST_SYNCED_SEQ_KEY)).toBeNull();
    expect(localStorage.getItem("timedata_last_synced")).toBeNull();
    expect(localStorage.getItem("timedata_legacy_snapshot_sync")).toBeNull();
  });
});

describe("Dexie database", () => {
  it("drops health stores on upgrade from v16 and keeps other data", async () => {
    db.close();
    await db.delete();

    // 造一个 v16 老库：健康 store 齐全且有数据，另有一条要活下来的分类。
    const legacy = new Dexie("timedata");
    legacy.version(16).stores({
      categories: "id, parentId, sortOrder",
      quickNotes: "id, occurredAt, updatedAt",
      timeEntries: "id, categoryId, startTime, endTime",
      tasks: "id, parentId, ruleId, sessionId, scheduledAt, sortOrder, updatedAt",
      tracks: "id, status, updatedAt",
      trackSteps: "id, trackId, [trackId+seq], updatedAt",
      goals: "id, kind, status, updatedAt",
      goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt",
      syncLog: "id, tableName, recordId, synced, [tableName+synced]",
      settings: "key",
      healthHeartRate: "id, date",
      healthHrv: "id, date",
      healthSleep: "id, date",
      healthStress: "id, date",
      runs: "id, date",
      healthCharts: "id, order, updatedAt",
      sessions: "id, startedAt, updatedAt",
    });
    await legacy.open();
    await legacy.table("healthHeartRate").put({ id: "hr-1", date: "2026-01-01" });
    await legacy.table("runs").put({ id: "run-1", date: "2026-01-01" });
    await legacy.table("categories").put({ id: "cat-keep", name: "保留我", parentId: null, color: "#111111", sortOrder: 0 });
    legacy.close();

    await db.open();

    const tableNames = db.tables.map((table) => table.name);
    expect(tableNames).not.toContain("healthHeartRate");
    expect(tableNames).not.toContain("healthHrv");
    expect(tableNames).not.toContain("healthSleep");
    expect(tableNames).not.toContain("healthStress");
    expect(tableNames).not.toContain("runs");
    expect(tableNames).not.toContain("healthCharts");
    await expect(db.categories.get("cat-keep")).resolves.toMatchObject({ name: "保留我" });
  });

  it("creates the current schema and seeds default categories on a fresh open", async () => {
    await db.delete();

    await db.open();
    await seedDefaultCategories();

    expect(await db.categories.count()).toBeGreaterThan(0);
    expect(db.verno).toBe(19);
    expect(db.tables.some((table) => table.name === "autoBackups")).toBe(false);
    expect(db.settings.schema.primKey.keyPath).toBe("key");
    expect(db.quickNotes.schema.primKey.keyPath).toBe("id");
    expect(db.quickNotes.schema.idxByName.occurredAt).toBeDefined();
    expect(db.quickNotes.schema.idxByName.updatedAt).toBeDefined();
    expect(db.tasks.schema.primKey.keyPath).toBe("id");
    expect(db.tasks.schema.idxByName.goalId).toBeUndefined();
    expect(db.tasks.schema.idxByName.parentId).toBeDefined();
    expect(db.tasks.schema.idxByName.ruleId).toBeDefined();
    expect(db.tasks.schema.idxByName.sessionId).toBeDefined();
    expect(db.tasks.schema.idxByName.sortOrder).toBeDefined();
    expect(db.tasks.schema.idxByName.updatedAt).toBeDefined();
    expect(db.sessions.schema.primKey.keyPath).toBe("id");
    expect(db.sessions.schema.idxByName.startedAt).toBeDefined();
    expect(db.sessions.schema.idxByName.updatedAt).toBeDefined();
    expect(db.sessions.schema.idxByName.endedAt).toBeUndefined();
    // 健康数据层已退役（ADR 0031）：全新建库不得再出现这些 store。
    expect(db.tables.some((table) => table.name === "healthCharts")).toBe(false);
    expect(db.tables.some((table) => table.name === "healthHeartRate")).toBe(false);
    expect(db.tables.some((table) => table.name === "runs")).toBe(false);
    expect(db.tracks.schema.primKey.keyPath).toBe("id");
    expect(db.tracks.schema.idxByName.goalId).toBeUndefined();
    expect(db.tracks.schema.idxByName.status).toBeDefined();
    expect(db.tracks.schema.idxByName.updatedAt).toBeDefined();
    expect(db.trackSteps.schema.primKey.keyPath).toBe("id");
    expect(db.trackSteps.schema.idxByName.trackId).toBeDefined();
    expect(db.trackSteps.schema.idxByName["[trackId+seq]"]).toBeDefined();
    expect(db.trackSteps.schema.idxByName.updatedAt).toBeDefined();
    expect(db.goals.schema.primKey.keyPath).toBe("id");
    expect(db.goals.schema.idxByName.kind).toBeDefined();
    expect(db.goals.schema.idxByName.status).toBeDefined();
    expect(db.goals.schema.idxByName.updatedAt).toBeDefined();
    expect(db.goalLayoutPins.schema.primKey.keyPath).toEqual(["goalId", "nodeKind", "nodeId"]);
    expect(db.goalLayoutPins.schema.idxByName.goalId).toBeDefined();
    expect(db.goalLayoutPins.schema.idxByName.nodeKind).toBeDefined();
    expect(db.goalLayoutPins.schema.idxByName.nodeId).toBeDefined();
    expect(db.goalLayoutPins.schema.idxByName.updatedAt).toBeDefined();
    expect(db.migrationSnapshots.schema.primKey.keyPath).toBe("key");
  });

  it("exposes a tasks table keyed by id", async () => {
    await db.open();

    await db.tasks.put({
      id: "t1",
      title: "x",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      sortOrder: 0,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    await expect(db.tasks.get("t1")).resolves.toMatchObject({ title: "x" });
  });

  it("migrates legacy sleep category setting to synced settings once", async () => {
    await db.open();
    localStorage.setItem("timedata_sleep_category_id", "cat-sleep");

    await migrateLocalSettingsToDexie();
    await migrateLocalSettingsToDexie();

    await expect(db.settings.get("sleep.categoryId")).resolves.toMatchObject({ value: "cat-sleep" });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: "sleep.categoryId", action: "create", synced: 0 },
    ]);
  });

  it("resets core data and tracks without deleting quick notes or their pending sync logs", async () => {
    await db.open();
    await db.tasks.add({
      id: "task-1",
      title: "x",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      sortOrder: 0,
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.quickNotes.add({
      id: "note-1",
      text: "repo",
      occurredAt: "2026-06-01T04:01:30.123Z",
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.tracks.add({
      id: "track-1",
      title: "T1",
      status: "active",
      refs: [],
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.goals.add({
      id: "goal-1",
      title: "目标",
      kind: "project",
      status: "active",
      members: [],
      prerequisites: [],
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.trackSteps.add({
      id: "step-1",
      trackId: "track-1",
      source: "agent",
      content: "",
      startedAt: "2026-06-01T04:02:00.000Z",
      endedAt: null,
      refs: [],
      tags: [],
      seq: 0,
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.syncLog.bulkAdd([
      {
        id: "note-log-1",
        tableName: "quick_notes",
        recordId: "note-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
      {
        id: "task-log-1",
        tableName: "tasks",
        recordId: "task-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
      {
        id: "track-log-1",
        tableName: "tracks",
        recordId: "track-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
      {
        id: "goal-log-1",
        tableName: "goals",
        recordId: "goal-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
      {
        id: "step-log-1",
        tableName: "track_steps",
        recordId: "step-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
      {
        id: "entry-log-1",
        tableName: "time_entries",
        recordId: "entry-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      },
    ]);

    await resetLocalDataToDefaults();

    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({ text: "repo" });
    await expect(db.tasks.get("task-1")).resolves.toBeUndefined();
    await expect(db.goals.get("goal-1")).resolves.toBeUndefined();
    await expect(db.tracks.get("track-1")).resolves.toBeUndefined();
    await expect(db.trackSteps.get("step-1")).resolves.toBeUndefined();
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { id: "note-log-1", tableName: "quick_notes", recordId: "note-1" },
    ]);
  });
});
