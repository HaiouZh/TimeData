import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalLayoutPin, QuickNote, SyncLogEntry, Task } from "@timedata/shared";
import { db } from "../db/index.js";

const apiFetchMock = vi.hoisted(() => vi.fn());
const ApiErrorMock = vi.hoisted(() => class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly details: string,
    public readonly body: unknown,
  ) {
    super(`API error: ${status} ${statusText}${details ? ` - ${details.slice(0, 200)}` : ""}`);
  }
});

vi.mock("../lib/api.js", () => ({
  ApiError: ApiErrorMock,
  apiFetch: apiFetchMock,
}));

import { advanceSeqCursor, canSkipEchoPull, clearBumpStash, compactSyncLogs, getClockSkewMs, getConsecutiveSyncFailureCount, getLastSyncedSeq, getQuarantinedSyncLogs, getSyncHealth, localContentHash, prepareForcePush, pruneSyncedLogs, requeueQuarantinedSyncLogs, recordClockSkew, recordRegularSyncFailure, recordSyncLog, recordSyncLogs, regularSync, resetConsecutiveSyncFailures, setLastSyncedSeq, shouldOpenSyncDiagnostics, stashBumpPayload, syncForcePushToServer, syncPush, syncPull, syncPullSinceSeq, syncForceReplace, yieldToMainThread, SYNC_HEDGE_DELAY_MS } from "./engine.js";
import { createPhaseRecorder } from "./phaseTimings.js";
import { syncScheduler } from "./scheduler.js";

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

function log(
  recordId: string,
  action: SyncLogEntry["action"],
  minute: string,
  tableName: SyncLogEntry["tableName"] = "time_entries",
): SyncLogEntry {
  return {
    id: `${recordId}-${action}-${minute}`,
    tableName,
    recordId,
    action,
    timestamp: `2026-05-06T00:${minute}:00.000Z`,
    synced: 0,
  };
}

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.quickNotes.clear();
  await db.tasks.clear();
  if ("goalLayoutPins" in db) await db.goalLayoutPins.clear();
  await db.syncLog.clear();
  await db.categories.clear();
  await db.settings.clear();
  localStorage.clear();
  apiFetchMock.mockReset();
});

describe("recordSyncLog", () => {
  it("writes new logs with numeric unsynced state", async () => {
    await recordSyncLog("time_entries", "entry-1", "create");

    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "time_entries", recordId: "entry-1", action: "create", synced: 0 },
    ]);
  });

  it("recordSyncLog stores deleteReason and push carries it on delete change", async () => {
    await recordSyncLog("tasks", "task-del-1", "delete", undefined, undefined, "user");
    const logs = await db.syncLog.where("recordId").equals("task-del-1").toArray();
    expect(logs[0].deleteReason).toBe("user");

    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "tasks",
          recordId: "task-del-1",
          action: "delete",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: logs[0].timestamp,
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-07-12T00:01:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes).toEqual([
      {
        tableName: "tasks",
        recordId: "task-del-1",
        action: "delete",
        data: null,
        timestamp: logs[0].timestamp,
        deleteReason: "user",
      },
    ]);
  });
});

describe("写入触发下沉", () => {
  afterEach(() => {
    syncScheduler.dispose();
  });

  it("recordSyncLog 写入后调用 syncScheduler.notifyWrite", async () => {
    const notifySpy = vi.spyOn(syncScheduler, "notifyWrite");

    await recordSyncLog("tasks", "id-1", "create");

    expect(notifySpy).toHaveBeenCalledTimes(1);
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "tasks", recordId: "id-1", action: "create", synced: 0 },
    ]);

    notifySpy.mockRestore();
  });

  it("recordSyncLogs 批量写入 N 条并只 notify 一次", async () => {
    const notifySpy = vi.spyOn(syncScheduler, "notifyWrite");

    await recordSyncLogs([
      { tableName: "tasks", recordId: "id-1", action: "create" },
      { tableName: "tasks", recordId: "id-2", action: "update" },
      { tableName: "tasks", recordId: "id-3", action: "delete" },
    ]);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    await expect(db.syncLog.count()).resolves.toBe(3);
    const logs = await db.syncLog.toArray();
    expect(new Set(logs.map((entry) => entry.id)).size).toBe(3);
    expect(logs.every((entry) => entry.synced === 0)).toBe(true);

    notifySpy.mockRestore();
  });

  it("recordSyncLogs 空数组不写不 notify", async () => {
    const notifySpy = vi.spyOn(syncScheduler, "notifyWrite");

    await recordSyncLogs([]);

    expect(notifySpy).not.toHaveBeenCalled();
    await expect(db.syncLog.count()).resolves.toBe(0);

    notifySpy.mockRestore();
  });
});

describe("pruneSyncedLogs", () => {
  it("删除超过保留窗口的 synced=1 日志，保留窗口内与未同步的日志", async () => {
    const now = Date.parse("2026-07-02T00:00:00.000Z");
    await db.syncLog.bulkAdd([
      { id: "old-synced", tableName: "tasks", recordId: "a", action: "update",
        timestamp: "2026-06-20T00:00:00.000Z", synced: 1 },
      { id: "fresh-synced", tableName: "tasks", recordId: "b", action: "update",
        timestamp: "2026-07-01T00:00:00.000Z", synced: 1 },
      { id: "old-unsynced", tableName: "tasks", recordId: "c", action: "update",
        timestamp: "2026-06-01T00:00:00.000Z", synced: 0 },
    ]);
    const deleted = await pruneSyncedLogs(() => now);
    expect(deleted).toBe(1);
    const remaining = (await db.syncLog.toArray()).map((l) => l.id).sort();
    expect(remaining).toEqual(["fresh-synced", "old-unsynced"]);
  });

  it("同窗口回收 synced=2 的隔离死信日志", async () => {
    const now = Date.parse("2026-07-02T00:00:00.000Z");
    await db.syncLog.bulkAdd([
      { id: "old-quarantined", tableName: "tasks", recordId: "a", action: "update",
        timestamp: "2026-06-20T00:00:00.000Z", synced: 2 },
      { id: "fresh-quarantined", tableName: "tasks", recordId: "b", action: "update",
        timestamp: "2026-07-01T00:00:00.000Z", synced: 2 },
    ]);
    const deleted = await pruneSyncedLogs(() => now);
    expect(deleted).toBe(1);
    const remaining = (await db.syncLog.toArray()).map((l) => l.id).sort();
    expect(remaining).toEqual(["fresh-quarantined"]);
  });
});

describe("sync seq cursor", () => {
  it("stores numeric seq cursor and ignores invalid values", () => {
    expect(getLastSyncedSeq()).toBeNull();

    setLastSyncedSeq(7);
    expect(getLastSyncedSeq()).toBe(7);

    localStorage.setItem("timedata_last_synced_seq", "not-a-number");
    expect(getLastSyncedSeq()).toBeNull();
  });

  it("advances seq cursor from pull response without downgrading", () => {
    setLastSyncedSeq(10);

    advanceSeqCursor({ changes: [], serverTime: "2026-05-08T10:00:00.000Z", latestSeq: 8 });
    expect(getLastSyncedSeq()).toBe(10);

    advanceSeqCursor({ changes: [], serverTime: "2026-05-08T10:01:00.000Z", latestSeq: 12 });
    expect(getLastSyncedSeq()).toBe(12);
  });
});

describe("localContentHash", () => {
  const quickNote: QuickNote = {
    id: "note-1",
    text: "hi",
    occurredAt: "2026-06-03T00:00:00.000Z",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  };
  const task: Task = {
    id: "task-1",
    title: "跑步",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    sortOrder: 0,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  };

  it("ignores quick note source metadata", async () => {
    const withoutSource = await localContentHash([], [], [quickNote]);
    const withSource = await localContentHash([], [], [{ ...quickNote, source: "agent", sourceLabel: "Hermes" }]);

    expect(withSource).toBe(withoutSource);
  });

  it("includes quick note pinned state", async () => {
    const unpinned = await localContentHash([], [], [quickNote]);
    const pinned = await localContentHash([], [], [{ ...quickNote, pinned: true }]);

    expect(pinned).not.toBe(unpinned);
  });

  it("includes task content", async () => {
    const withoutTask = await localContentHash([], [], []);
    const withTask = await localContentHash([], [], [], [task]);

    expect(withTask).not.toBe(withoutTask);
  });
});

describe("regular sync failure diagnostics", () => {
  it("counts non-network API failures and recommends diagnostics after three failures", () => {
    localStorage.clear();

    recordRegularSyncFailure(new Error("API error: 409 Conflict - push rejected"));
    recordRegularSyncFailure(new Error("API error: 409 Conflict - push rejected"));
    expect(getConsecutiveSyncFailureCount()).toBe(2);
    expect(shouldOpenSyncDiagnostics()).toBe(false);

    recordRegularSyncFailure(new Error("API error: 409 Conflict - push rejected"));
    expect(getConsecutiveSyncFailureCount()).toBe(3);
    expect(shouldOpenSyncDiagnostics()).toBe(true);
  });

  it("does not count network connection failures as sync-health failures", () => {
    localStorage.clear();

    recordRegularSyncFailure(new Error("网络请求失败：无法连接 https://example.com"));

    expect(getConsecutiveSyncFailureCount()).toBe(0);
    expect(shouldOpenSyncDiagnostics()).toBe(false);
  });

  it("resets sync failure count after success", () => {
    localStorage.clear();
    recordRegularSyncFailure(new Error("API error: 409 Conflict"));

    resetConsecutiveSyncFailures();

    expect(getConsecutiveSyncFailureCount()).toBe(0);
  });
});

describe("getSyncHealth", () => {
  it("compares sync health by contentHash when available", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T10:00:00",
    });
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T11:00:00",
    });

    const localPayload = JSON.stringify({
      categories: [{
        id: "cat-1",
        name: "Work",
        parentId: null,
        color: "#3366ff",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-08T08:00:00",
        updatedAt: "2026-05-08T10:00:00",
      }],
      timeEntries: [{
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T11:00:00",
      }],
      quickNotes: [],
      tasks: [],
    });
    const localDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(localPayload));
    const localHash = [...new Uint8Array(localDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    apiFetchMock.mockResolvedValue({
      categoryCount: 1,
      entryCount: 1,
      quickNoteCount: 0,
      lastUpdatedAt: "2026-05-08T11:00:00",
      contentHash: localHash,
      serverTime: "2026-05-08T12:00:00.000Z",
    });

    const report = await getSyncHealth();

    expect(report.local).toMatchObject({ categoryCount: 1, entryCount: 1, lastUpdatedAt: "2026-05-08T11:00:00" });
    expect(report.server.contentHash).toBe(localHash);
    expect(report.recommendation).toBe("already_aligned");
  });

});

describe("syncForcePushToServer", () => {
  it("只确认快照边界内五个覆盖域的日志，保留请求期间新日志和未覆盖域日志", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: "local",
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-1", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });
    await db.syncLog.add({ id: "excluded-log", tableName: "tracks", recordId: "track-1", action: "update", timestamp: "2026-05-08T09:01:00.000Z", synced: 0 });
    await db.settings.add({ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-08T08:30:00.000Z" });
    await db.quickNotes.add({
      id: "note-1",
      text: "repo",
      occurredAt: "2026-05-08T08:40:00.000Z",
      createdAt: "2026-05-08T08:40:00.000Z",
      updatedAt: "2026-05-08T08:40:00.000Z",
    });
    await db.tasks.add({
      id: "task-1",
      title: "跑步",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      lastDoneAt: null,
      startAt: "2026-05-08T08:45:00.000Z",
      sortOrder: 0,
      createdAt: "2026-05-08T08:45:00.000Z",
      updatedAt: "2026-05-08T08:45:00.000Z",
    });

    apiFetchMock
      .mockResolvedValueOnce({
        confirmToken: "token-1",
        expiresAt: "2026-05-08T12:05:00.000Z",
        confirmationPhrase: "OVERWRITE_SERVER",
        serverStatus: { categoryCount: 0, entryCount: 0, quickNoteCount: 0, lastUpdatedAt: null, serverTime: "2026-05-08T12:00:00.000Z" },
      })
      .mockImplementationOnce(async () => {
        await db.syncLog.add({
          id: "during-request-log",
          tableName: "tasks",
          recordId: "task-during-request",
          action: "create",
          timestamp: "2026-05-08T12:00:30.000Z",
          synced: 0,
        });
        return {
        importedCategories: 1,
        importedTimeEntries: 1,
        importedQuickNotes: 1,
        importedTasks: 1,
        backupId: "sync_force_push-1",
        serverTime: "2026-05-08T12:01:00.000Z",
        latestSeq: 42,
        };
      });

    const prepared = await prepareForcePush();
    const result = await syncForcePushToServer(prepared.confirmToken, "OVERWRITE_SERVER");

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/force-push/prepare", {
      method: "POST",
      body: JSON.stringify({
        categoryCount: 1,
        entryCount: 1,
        quickNoteCount: 1,
        lastUpdatedAt: "2026-05-08T09:00:00",
      }),
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/force-push", expect.objectContaining({ method: "POST" }));
    const forcePushBody = JSON.parse(apiFetchMock.mock.calls[1][1].body);
    expect(forcePushBody.categories).toHaveLength(1);
    expect(forcePushBody.timeEntries).toHaveLength(1);
    expect(forcePushBody.settings).toEqual([{ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-08T08:30:00.000Z" }]);
    expect(forcePushBody.quickNotes).toEqual([
      {
        id: "note-1",
        text: "repo",
        occurredAt: "2026-05-08T08:40:00.000Z",
        createdAt: "2026-05-08T08:40:00.000Z",
        updatedAt: "2026-05-08T08:40:00.000Z",
      },
    ]);
    expect(forcePushBody.tasks).toEqual([
      {
        id: "task-1",
        title: "跑步",
        done: false,
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        lastDoneAt: null,
        startAt: "2026-05-08T08:45:00.000Z",
        sortOrder: 0,
        createdAt: "2026-05-08T08:45:00.000Z",
        updatedAt: "2026-05-08T08:45:00.000Z",
      },
    ]);
    expect(result).toMatchObject({ importedCategories: 1, importedTimeEntries: 1, importedQuickNotes: 1, importedTasks: 1, backupId: "sync_force_push-1" });
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get("excluded-log")).resolves.toMatchObject({ synced: 0 });
    await expect(db.syncLog.get("during-request-log")).resolves.toMatchObject({ synced: 0 });
    expect(localStorage.getItem("timedata_last_synced_seq")).toBe("42");
  });
});

describe("syncPush", () => {
  it("pushes settings changes from syncLog", async () => {
    await db.settings.add({ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" });
    await db.syncLog.add({
      id: "setting-log-1",
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "update",
      timestamp: "2026-05-30T00:30:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "update",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: "2026-05-30T00:30:00.000Z",
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-05-30T01:00:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes).toEqual([
      {
        tableName: "settings",
        recordId: "sleep.categoryId",
        action: "update",
        data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
        timestamp: "2026-05-30T00:30:00.000Z",
      },
    ]);
    await expect(db.syncLog.get("setting-log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("pushes compound-key goal layout pins from syncLog", async () => {
    const pin: GoalLayoutPin = {
      goalId: "goal-1",
      nodeKind: "goal",
      nodeId: "goal-1",
      x: 100,
      y: 200,
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    await db.goalLayoutPins.add(pin);
    await db.syncLog.add({
      id: "pin-log-1",
      tableName: "goal_layout_pins",
      recordId: "goal-1|goal|goal-1",
      action: "create",
      timestamp: "2026-06-24T00:00:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "goal_layout_pins",
          recordId: "goal-1|goal|goal-1",
          action: "create",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: "2026-06-24T00:00:00.000Z",
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-06-24T00:01:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes).toEqual([
      {
        tableName: "goal_layout_pins",
        recordId: "goal-1|goal|goal-1",
        action: "create",
        data: pin,
        timestamp: "2026-06-24T00:00:00.000Z",
      },
    ]);
    await expect(db.syncLog.get("pin-log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("pushes quick note changes without category dependency changes", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.quickNotes.add({
      id: "note-1",
      text: "repo",
      occurredAt: "2026-06-01T04:01:30.123Z",
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.syncLog.add({
      id: "note-log-1",
      tableName: "quick_notes",
      recordId: "note-1",
      action: "create",
      timestamp: "2026-06-01T04:02:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "quick_notes",
          recordId: "note-1",
          action: "create",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: "2026-06-01T04:02:00.000Z",
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-06-01T04:03:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes).toEqual([
      {
        tableName: "quick_notes",
        recordId: "note-1",
        action: "create",
        data: {
          id: "note-1",
          text: "repo",
          occurredAt: "2026-06-01T04:01:30.123Z",
          createdAt: "2026-06-01T04:02:00.000Z",
          updatedAt: "2026-06-01T04:02:00.000Z",
        },
        timestamp: "2026-06-01T04:02:00.000Z",
      },
    ]);
    await expect(db.syncLog.get("note-log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("pushes task changes without category dependency changes", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.tasks.add({
      id: "task-1",
      title: "跑步",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      lastDoneAt: null,
      startAt: "2026-06-01T00:00:00.000Z",
      sortOrder: 0,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    await db.syncLog.add({
      id: "task-log-1",
      tableName: "tasks",
      recordId: "task-1",
      action: "create",
      timestamp: "2026-06-01T00:00:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "tasks",
          recordId: "task-1",
          action: "create",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: "2026-06-01T00:00:00.000Z",
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-06-01T00:01:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes).toEqual([
      {
        tableName: "tasks",
        recordId: "task-1",
        action: "create",
        data: {
          id: "task-1",
          title: "跑步",
          done: false,
          recurrence: { freq: "daily", interval: 1, basis: "due" },
          lastDoneAt: null,
          startAt: "2026-06-01T00:00:00.000Z",
          sortOrder: 0,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        timestamp: "2026-06-01T00:00:00.000Z",
      },
    ]);
    await expect(db.syncLog.get("task-log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("pushes task completion op from syncLog into the change payload", async () => {
    await db.tasks.add({
      id: "task-complete",
      title: "跑步",
      done: true,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      sortOrder: 0,
      completedAt: "2026-07-04T01:00:00.000Z",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T01:00:00.000Z",
    });
    await db.syncLog.add({
      id: "task-complete-log",
      tableName: "tasks",
      recordId: "task-complete",
      action: "update",
      timestamp: "2026-07-04T01:00:00.000Z",
      synced: 0,
      op: { type: "complete", at: "2026-07-04T01:00:00.000Z" },
    });
    apiFetchMock.mockResolvedValue({
      outcomes: [
        {
          tableName: "tasks",
          recordId: "task-complete",
          action: "update",
          status: "accepted",
          reasonCode: "applied",
          message: "applied",
          incomingTimestamp: "2026-07-04T01:00:00.000Z",
        },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-07-04T01:01:00.000Z",
    });

    await expect(syncPush()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(pushBody.changes[0].op).toEqual({ type: "complete", at: "2026-07-04T01:00:00.000Z" });
    await expect(db.syncLog.get("task-complete-log")).resolves.toMatchObject({ synced: 1 });
  });

  it("原子 409 不误确认，剔除问题项后立即重试合法子批", async () => {
    const acceptedLogId = "entry-accepted-create-00";
    const conflictLogId = "entry-conflict-create-30";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.bulkAdd([
      {
        id: "entry-accepted",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
      {
        id: "entry-conflict",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: null,
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
    ]);
    await db.syncLog.bulkAdd([
      { id: acceptedLogId, tableName: "time_entries", recordId: "entry-accepted", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 },
      { id: conflictLogId, tableName: "time_entries", recordId: "entry-conflict", action: "create", timestamp: "2026-05-08T09:30:00", synced: 0 },
    ]);

    const pushResponse = {
      outcomes: [
        { tableName: "time_entries", recordId: "entry-accepted", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" },
        { tableName: "time_entries", recordId: "entry-conflict", action: "create", status: "conflict", reasonCode: "overlap", message: "entry overlaps existing entry server-entry", incomingTimestamp: "2026-05-08T09:30:00" },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 1,
      backupId: null,
      serverTime: "2026-05-08T09:31:00.000Z",
    };
    const error = new ApiErrorMock(409, "Conflict", "", pushResponse);
    apiFetchMock
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        outcomes: [
          { tableName: "time_entries", recordId: "entry-accepted", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" },
        ],
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        backupId: null,
        serverTime: "2026-05-08T09:32:00.000Z",
        latestSeq: 11,
        appliedCount: 1,
      });

    const result = await syncPush();

    expect(result).toMatchObject({ accepted: 1, rejected: 0, conflicts: 1, issues: [expect.objectContaining({ recordId: "entry-conflict", reasonCode: "overlap" })] });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(apiFetchMock.mock.calls[1][1].body);
    expect(firstBody.changes).toHaveLength(3);
    expect(retryBody.changes).toEqual([
      expect.objectContaining({ tableName: "categories", recordId: "cat-1" }),
      expect.objectContaining({ tableName: "time_entries", recordId: "entry-accepted", action: "create" }),
    ]);
    await expect(db.syncLog.get(acceptedLogId)).resolves.toMatchObject({ synced: 1 });
    // 服务端会持续拒收同一载荷：隔离为死信，不再逐轮重发（用户修正后产生新日志重新入队）。
    await expect(db.syncLog.get(conflictLogId)).resolves.toMatchObject({ synced: 2 });
  });

  it("409 拆批重试的子批使用新 requestId", async () => {
    const acceptedLogId = "entry-accepted-create-00";
    const conflictLogId = "entry-conflict-create-30";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.bulkAdd([
      {
        id: "entry-accepted",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
      {
        id: "entry-conflict",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: null,
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
    ]);
    await db.syncLog.bulkAdd([
      { id: acceptedLogId, tableName: "time_entries", recordId: "entry-accepted", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 },
      { id: conflictLogId, tableName: "time_entries", recordId: "entry-conflict", action: "create", timestamp: "2026-05-08T09:30:00", synced: 0 },
    ]);

    const pushResponse = {
      outcomes: [
        { tableName: "time_entries", recordId: "entry-accepted", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" },
        { tableName: "time_entries", recordId: "entry-conflict", action: "create", status: "conflict", reasonCode: "overlap", message: "entry overlaps existing entry server-entry", incomingTimestamp: "2026-05-08T09:30:00" },
      ],
      accepted: 1,
      rejected: 0,
      conflicts: 1,
      backupId: null,
      serverTime: "2026-05-08T09:31:00.000Z",
    };
    const error = new ApiErrorMock(409, "Conflict", "", pushResponse);
    apiFetchMock
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        outcomes: [
          { tableName: "time_entries", recordId: "entry-accepted", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" },
        ],
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        backupId: null,
        serverTime: "2026-05-08T09:32:00.000Z",
        latestSeq: 11,
        appliedCount: 1,
      });

    await syncPush();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(apiFetchMock.mock.calls[1][1].body);
    expect(retryBody.requestId).not.toBe(firstBody.requestId);
  });

  it("原子 409 的死信日志被隔离后不再进入下一轮 push，可手动重新入队", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-bad",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: "bad-log", tableName: "time_entries", recordId: "entry-bad", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });

    apiFetchMock.mockRejectedValueOnce(new ApiErrorMock(409, "Conflict", "", {
      outcomes: [
        { tableName: "categories", recordId: "cat-1", action: "create", status: "accepted", reasonCode: "validated", message: "passed validation", incomingTimestamp: "2026-05-08T08:00:00" },
        { tableName: "time_entries", recordId: "entry-bad", action: "create", status: "rejected", reasonCode: "overlap", message: "overlap", incomingTimestamp: "2026-05-08T09:00:00" },
      ],
      accepted: 1,
      rejected: 1,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-05-08T09:01:00.000Z",
    })).mockResolvedValue({
      outcomes: [],
      accepted: 0,
      rejected: 0,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-05-08T09:02:00.000Z",
      latestSeq: 5,
      appliedCount: 0,
    });

    await syncPush();
    await expect(db.syncLog.get("bad-log")).resolves.toMatchObject({ synced: 2 });
    await expect(getQuarantinedSyncLogs()).resolves.toHaveLength(1);

    // 死信不再参与下一轮 push：没有其他 pending 时直接 no-op、零请求。
    apiFetchMock.mockClear();
    await syncPush();
    expect(apiFetchMock).not.toHaveBeenCalled();

    // 手动重新入队后恢复 pending。
    await expect(requeueQuarantinedSyncLogs()).resolves.toBe(1);
    await expect(db.syncLog.get("bad-log")).resolves.toMatchObject({ synced: 0 });
  });

  it("keeps rejected push logs unsynced", async () => {
    const acceptedLogId = "log-accepted";
    const rejectedLogId = "log-rejected";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.bulkAdd([
      {
        id: "entry-accepted",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
      {
        id: "entry-rejected",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: null,
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
    ]);
    await db.syncLog.bulkAdd([
      { id: acceptedLogId, tableName: "time_entries", recordId: "entry-accepted", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 },
      { id: rejectedLogId, tableName: "time_entries", recordId: "entry-rejected", action: "create", timestamp: "2026-05-08T09:30:00", synced: 0 },
    ]);

    apiFetchMock.mockResolvedValue({
      outcomes: [
        { tableName: "time_entries", recordId: "entry-accepted", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" },
        { tableName: "time_entries", recordId: "entry-rejected", action: "create", status: "rejected", reasonCode: "overlap", message: "overlap", incomingTimestamp: "2026-05-08T09:30:00" },
      ],
      accepted: 1,
      rejected: 1,
      conflicts: 0,
      backupId: "sync_push-2026-05-08T09-00-00",
      serverTime: "2026-05-08T09:31:00.000Z",
    });

    const result = await syncPush();

    expect(result).toMatchObject({ accepted: 1, rejected: 1, conflicts: 0, issues: [expect.objectContaining({ recordId: "entry-rejected", reasonCode: "overlap" })] });
    await expect(db.syncLog.get(acceptedLogId)).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get(rejectedLogId)).resolves.toMatchObject({ synced: 0 });
  });

  it("sends base seq with push requests", async () => {
    setLastSyncedSeq(9);

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-1", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });

    apiFetchMock.mockResolvedValue({
      outcomes: [{ tableName: "time_entries", recordId: "entry-1", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" }],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: "backup-1",
      serverTime: "2026-05-08T09:01:00.000Z",
    });

    await syncPush();

    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.baseSeq).toBe(9);
  });

  it("push 携带 requestId 与对冲选项", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-1", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });

    apiFetchMock.mockResolvedValue({
      outcomes: [{ tableName: "time_entries", recordId: "entry-1", action: "create", status: "accepted", reasonCode: "applied", message: "applied", incomingTimestamp: "2026-05-08T09:00:00" }],
      accepted: 1,
      rejected: 0,
      conflicts: 0,
      backupId: "backup-1",
      serverTime: "2026-05-08T09:01:00.000Z",
    });

    await syncPush();

    const pushCall = apiFetchMock.mock.calls.find(([path]) => path === "/api/sync/push");
    const body = JSON.parse(pushCall[1].body);
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(pushCall[1]).toMatchObject({ hedge: { delayMs: SYNC_HEDGE_DELAY_MS } });
  });

  it("client_bug reasonCode marks syncLog synced to stop retrying", async () => {
    const clientBugLogId = "entry-bug-create-00";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-bug",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: clientBugLogId, tableName: "time_entries", recordId: "entry-bug", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });

    apiFetchMock.mockResolvedValue({
      outcomes: [{ tableName: "time_entries", recordId: "entry-bug", action: "create", status: "rejected", reasonCode: "invalid_shape", message: "invalid shape", incomingTimestamp: "2026-05-08T09:00:00" }],
      accepted: 0,
      rejected: 1,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-05-08T09:01:00.000Z",
    });

    const result = await syncPush();

    expect(result.clientBugIssues).toHaveLength(1);
    expect(result.clientBugIssues[0]).toMatchObject({ reasonCode: "invalid_shape" });
    await expect(db.syncLog.get(clientBugLogId)).resolves.toMatchObject({ synced: 1 });
  });

  it("user_actionable reasonCode does not mark synced but returns in userActionableIssues", async () => {
    const actionableLogId = "entry-actionable-create-00";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-actionable",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00",
      endTime: "2026-05-08T10:00:00",
      note: null,
      createdAt: "2026-05-08T09:00:00",
      updatedAt: "2026-05-08T09:00:00",
    });
    await db.syncLog.add({ id: actionableLogId, tableName: "time_entries", recordId: "entry-actionable", action: "create", timestamp: "2026-05-08T09:00:00", synced: 0 });

    apiFetchMock.mockResolvedValue({
      outcomes: [{ tableName: "time_entries", recordId: "entry-actionable", action: "create", status: "rejected", reasonCode: "archived_category", message: "category is archived", incomingTimestamp: "2026-05-08T09:00:00" }],
      accepted: 0,
      rejected: 1,
      conflicts: 0,
      backupId: null,
      serverTime: "2026-05-08T09:01:00.000Z",
    });

    const result = await syncPush();

    expect(result.userActionableIssues).toHaveLength(1);
    expect(result.userActionableIssues[0]).toMatchObject({ reasonCode: "archived_category" });
    await expect(db.syncLog.get(actionableLogId)).resolves.toMatchObject({ synced: 0 });
  });

  it("conflict reasonCode (server_version_newer_or_same) is returned in issues but not synced", async () => {
    const conflictLogId = "entry-conflict-create-30";

    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });
    await db.timeEntries.add({
      id: "entry-conflict",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:30:00",
      endTime: "2026-05-08T10:30:00",
      note: null,
      createdAt: "2026-05-08T09:30:00",
      updatedAt: "2026-05-08T09:30:00",
    });
    await db.syncLog.add({ id: conflictLogId, tableName: "time_entries", recordId: "entry-conflict", action: "create", timestamp: "2026-05-08T09:30:00", synced: 0 });

    apiFetchMock.mockResolvedValue({
      outcomes: [{ tableName: "time_entries", recordId: "entry-conflict", action: "create", status: "conflict", reasonCode: "server_version_newer_or_same", message: "server has newer version", incomingTimestamp: "2026-05-08T09:30:00" }],
      accepted: 0,
      rejected: 0,
      conflicts: 1,
      backupId: null,
      serverTime: "2026-05-08T09:31:00.000Z",
    });

    const result = await syncPush();

    expect(result.conflicts).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ reasonCode: "server_version_newer_or_same" });
    await expect(db.syncLog.get(conflictLogId)).resolves.toMatchObject({ synced: 0 });
  });

  it("stale_rejected marks source syncLog synced and returns the issue", async () => {
    await db.settings.add({ key: "theme", value: "light", updatedAt: "2026-07-04T09:00:00.000Z" });
    await db.syncLog.add({
      id: "setting-stale-log",
      tableName: "settings",
      recordId: "theme",
      action: "update",
      timestamp: "2026-07-04T09:00:00.000Z",
      synced: 0,
    });

    apiFetchMock.mockResolvedValue({
      outcomes: [{
        tableName: "settings",
        recordId: "theme",
        action: "update",
        status: "conflict",
        reasonCode: "stale_change_rejected",
        message: "stale change rejected",
        incomingTimestamp: "2026-07-04T09:00:00.000Z",
        serverUpdatedAt: "2026-07-04T10:00:00.000Z",
      }],
      accepted: 0,
      rejected: 0,
      conflicts: 1,
      backupId: null,
      serverTime: "2026-07-04T10:00:01.000Z",
      latestSeq: 5,
      appliedCount: 0,
    });

    const result = await syncPush();

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ reasonCode: "stale_change_rejected" });
    await expect(db.syncLog.get("setting-stale-log")).resolves.toMatchObject({ synced: 1 });
  });
});

describe("clock skew", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records the local minus server clock skew", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:01:30.000Z"));

    recordClockSkew("2026-07-04T10:00:00.000Z");

    expect(getClockSkewMs()).toBe(90_000);
  });

  it("ignores invalid serverTime values", () => {
    recordClockSkew("not-a-date");

    expect(getClockSkewMs()).toBeNull();
  });
});

describe("syncPull", () => {
  it("rejects invalid pull responses", async () => {
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [{
        tableName: "time_entries",
        recordId: "entry-1",
        action: "create",
        data: null,
        timestamp: "2026-05-07T09:30:00.000Z",
      }],
    });

    await expect(syncPull()).rejects.toThrow("Invalid /api/sync/pull response");
  });

  it("does not write invalid category payloads from pull responses", async () => {
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [{
        tableName: "categories",
        recordId: "cat-invalid",
        action: "update",
        data: {
          id: "cat-invalid",
          name: "Broken",
          parentId: null,
          icon: null,
          sortOrder: 1,
          isArchived: false,
          createdAt: "2026-05-07T08:00:00.000Z",
          updatedAt: "2026-05-07T09:00:00.000Z",
        },
        timestamp: "2026-05-07T09:00:00.000Z",
      }],
    });

    await expect(syncPull()).rejects.toThrow("Invalid /api/sync/pull response");
    await expect(db.categories.get("cat-invalid")).resolves.toBeUndefined();
  });

  it("does not write invalid time entry payloads from pull responses", async () => {
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [{
        tableName: "time_entries",
        recordId: "entry-invalid",
        action: "update",
        data: {
          id: "entry-invalid",
          categoryId: "cat-1",
          startTime: "2026-05-07T09:00:00.000Z",
          endTime: "2026-05-07T08:00:00.000Z",
          note: null,
          createdAt: "2026-05-07T08:00:00.000Z",
          updatedAt: "2026-05-07T09:00:00.000Z",
        },
        timestamp: "2026-05-07T09:00:00.000Z",
      }],
    });

    await expect(syncPull()).rejects.toThrow("Invalid /api/sync/pull response");
    await expect(db.timeEntries.get("entry-invalid")).resolves.toBeUndefined();
  });

  it("uses seq cursor for incremental pulls when available", async () => {
    setLastSyncedSeq(21);

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      latestSeq: 22,
      changes: [],
    });

    await syncPull();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 21, limit: 500 }),
      hedge: { delayMs: SYNC_HEDGE_DELAY_MS },
    });
    expect(getLastSyncedSeq()).toBe(22);
  });



  it("applies settings upsert and delete changes from pull", async () => {
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-05-30T01:00:00.000Z",
      changes: [
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "update",
          data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
          timestamp: "2026-05-30T00:00:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.settings.get("sleep.categoryId")).resolves.toMatchObject({ value: "cat-1" });

    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-05-30T02:00:00.000Z",
      changes: [
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "delete",
          data: null,
          timestamp: "2026-05-30T02:00:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.settings.get("sleep.categoryId")).resolves.toBeUndefined();
  });

  it("applies quick note upsert and delete changes from pull", async () => {
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:03:00.000Z",
      changes: [
        {
          tableName: "quick_notes",
          recordId: "note-1",
          action: "update",
          data: {
            id: "note-1",
            text: "repo",
            occurredAt: "2026-06-01T04:01:30.123Z",
            createdAt: "2026-06-01T04:02:00.000Z",
            updatedAt: "2026-06-01T04:02:00.000Z",
            pinned: true,
          },
          timestamp: "2026-06-01T04:02:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({ text: "repo", pinned: true });

    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:04:00.000Z",
      changes: [
        {
          tableName: "quick_notes",
          recordId: "note-1",
          action: "delete",
          data: null,
          timestamp: "2026-06-01T04:04:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.quickNotes.get("note-1")).resolves.toBeUndefined();
  });

  it("applies task upsert and delete changes from pull", async () => {
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:03:00.000Z",
      changes: [
        {
          tableName: "tasks",
          recordId: "task-1",
          action: "update",
          data: {
            id: "task-1",
            title: "跑步",
            done: false,
            recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
            lastDoneAt: null,
            startAt: "2026-06-01T00:00:00.000Z",
            scheduledAt: null,
            sortOrder: 0,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T04:02:00.000Z",
          },
          timestamp: "2026-06-01T04:02:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.tasks.get("task-1")).resolves.toMatchObject({ title: "跑步", recurrence: { freq: "weekly" } });

    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:04:00.000Z",
      changes: [
        {
          tableName: "tasks",
          recordId: "task-1",
          action: "delete",
          data: null,
          timestamp: "2026-06-01T04:04:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.tasks.get("task-1")).resolves.toBeUndefined();
  });

  it("applies goal layout pin upsert and delete changes from pull", async () => {
    const pin: GoalLayoutPin = {
      goalId: "goal-1",
      nodeKind: "goal",
      nodeId: "goal-1",
      x: 100,
      y: 200,
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-24T00:01:00.000Z",
      changes: [
        {
          tableName: "goal_layout_pins",
          recordId: "goal-1|goal|goal-1",
          action: "update",
          data: pin,
          timestamp: "2026-06-24T00:00:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.goalLayoutPins.get(["goal-1", "goal", "goal-1"])).resolves.toEqual(pin);

    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-24T00:02:00.000Z",
      changes: [
        {
          tableName: "goal_layout_pins",
          recordId: "goal-1|goal|goal-1",
          action: "delete",
          data: null,
          timestamp: "2026-06-24T00:02:00.000Z",
        },
      ],
    });

    await expect(syncPull()).resolves.toBe(1);
    await expect(db.goalLayoutPins.get(["goal-1", "goal", "goal-1"])).resolves.toBeUndefined();
  });

  it("skips duplicate boundary records during incremental pull", async () => {
    await db.categories.add({
      id: "cat-boundary",
      name: "Boundary",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:30:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-boundary",
      categoryId: "cat-boundary",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "already applied",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:30:00.000Z",
    });
    localStorage.setItem("timedata_last_synced", "2026-05-07T09:30:00.000Z");

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "categories",
          recordId: "cat-boundary",
          action: "update",
          data: {
            id: "cat-boundary",
            name: "Boundary",
            parentId: null,
            color: "#3366ff",
            icon: null,
            sortOrder: 1,
            isArchived: false,
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
        {
          tableName: "time_entries",
          recordId: "entry-boundary",
          action: "update",
          data: {
            id: "entry-boundary",
            categoryId: "cat-boundary",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "already applied",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    const applied = await syncPull();

    expect(applied).toBe(0);
    await expect(db.timeEntries.get("entry-boundary")).resolves.toMatchObject({ note: "already applied" });
  });

  it("applies newer records while replaying the boundary timestamp", async () => {
    await db.timeEntries.add({
      id: "entry-boundary",
      categoryId: "cat-1",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "boundary",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:30:00.000Z",
    });
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-boundary",
          action: "update",
          data: {
            id: "entry-boundary",
            categoryId: "cat-1",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "boundary",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
        {
          tableName: "time_entries",
          recordId: "entry-newer",
          action: "update",
          data: {
            id: "entry-newer",
            categoryId: "cat-1",
            startTime: "2026-05-07T11:00:00.000Z",
            endTime: "2026-05-07T12:00:00.000Z",
            note: "newer",
            createdAt: "2026-05-07T10:00:00.000Z",
            updatedAt: "2026-05-07T11:30:00.000Z",
          },
          timestamp: "2026-05-07T11:30:00.000Z",
        },
      ],
    });

    const applied = await syncPull();

    expect(applied).toBe(1);
    await expect(db.timeEntries.get("entry-newer")).resolves.toMatchObject({ note: "newer" });
  });

  it("does not count repeated tombstones as applied during incremental pull", async () => {

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-deleted",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    const applied = await syncPull();

    expect(applied).toBe(0);
  });

  it("applies remote category delete by removing the category tree and affected entries", async () => {
    await db.categories.bulkAdd([
      {
        id: "work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code",
        name: "编码",
        parentId: "work",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "life",
        name: "生活",
        parentId: null,
        color: "#22C55E",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ]);
    await db.timeEntries.bulkAdd([
      {
        id: "entry-1",
        categoryId: "work-code",
        startTime: "2026-05-08T08:00:00",
        endTime: "2026-05-08T09:00:00",
        note: null,
        createdAt: "2026-05-08T08:00:00",
        updatedAt: "2026-05-08T08:00:00",
      },
      {
        id: "entry-2",
        categoryId: "life",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
    ]);

    apiFetchMock.mockResolvedValue({
      changes: [{
        tableName: "categories",
        recordId: "work",
        action: "delete",
        data: null,
        timestamp: "2026-05-08T12:00:00.000Z",
      }],
      serverTime: "2026-05-08T12:00:00.000Z",
      latestSeq: 9,
    });

    await expect(syncPull()).resolves.toBe(3);
    await expect(db.categories.get("work")).resolves.toBeUndefined();
    await expect(db.categories.get("work-code")).resolves.toBeUndefined();
    await expect(db.categories.get("life")).resolves.toMatchObject({ id: "life" });
    await expect(db.timeEntries.get("entry-1")).resolves.toBeUndefined();
    await expect(db.timeEntries.get("entry-2")).resolves.toMatchObject({ id: "entry-2" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("defensively removes deeper category descendants during remote category delete", async () => {
    await db.categories.bulkAdd([
      {
        id: "work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code",
        name: "编码",
        parentId: "work",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code-review",
        name: "评审",
        parentId: "work-code",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ]);
    await db.timeEntries.add({
      id: "entry-deep",
      categoryId: "work-code-review",
      startTime: "2026-05-08T08:00:00",
      endTime: "2026-05-08T09:00:00",
      note: null,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });

    apiFetchMock.mockResolvedValue({
      changes: [{
        tableName: "categories",
        recordId: "work",
        action: "delete",
        data: null,
        timestamp: "2026-05-08T12:00:00.000Z",
      }],
      serverTime: "2026-05-08T12:00:00.000Z",
      latestSeq: 9,
    });

    await expect(syncPull()).resolves.toBe(4);
    await expect(db.categories.count()).resolves.toBe(0);
    await expect(db.timeEntries.count()).resolves.toBe(0);
  });

  it("rolls back remote category delete when deleting categories fails", async () => {
    await db.categories.bulkAdd([
      {
        id: "work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code",
        name: "编码",
        parentId: "work",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ]);
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "work-code",
      startTime: "2026-05-08T08:00:00",
      endTime: "2026-05-08T09:00:00",
      note: null,
      createdAt: "2026-05-08T08:00:00",
      updatedAt: "2026-05-08T08:00:00",
    });

    apiFetchMock.mockResolvedValue({
      changes: [{
        tableName: "categories",
        recordId: "work",
        action: "delete",
        data: null,
        timestamp: "2026-05-08T12:00:00.000Z",
      }],
      serverTime: "2026-05-08T12:00:00.000Z",
      latestSeq: 9,
    });
    const bulkDeleteSpy = vi.spyOn(db.categories, "bulkDelete").mockRejectedValueOnce(new Error("boom"));

    await expect(syncPull()).rejects.toThrow("boom");
    await expect(db.timeEntries.count()).resolves.toBe(1);
    await expect(db.categories.count()).resolves.toBe(2);
    bulkDeleteSpy.mockRestore();
  });

  it("repairs a local blank entry from a full cloud pull", async () => {
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "",
      startTime: "",
      endTime: "",
      note: null,
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });

    localStorage.setItem("timedata_last_synced", "2026-05-07T12:30:00.000Z");

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-1",
          action: "update",
          data: {
            id: "entry-1",
            categoryId: "cat-1",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "云端完整记录",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    await syncPull({ mode: "repair" });

    await expect(db.timeEntries.get("entry-1")).resolves.toMatchObject({
      categoryId: "cat-1",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 0, limit: 500 }),
      hedge: { delayMs: SYNC_HEDGE_DELAY_MS },
    });
  });

  it("does not overwrite a complete newer local entry during repair", async () => {
    await db.timeEntries.add({
      id: "entry-2",
      categoryId: "local-cat",
      startTime: "2026-05-07T11:00:00.000Z",
      endTime: "2026-05-07T12:00:00.000Z",
      note: "本机较新记录",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-2",
          action: "update",
          data: {
            id: "entry-2",
            categoryId: "cloud-cat",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "云端旧记录",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    await syncPull({ mode: "repair" });

    await expect(db.timeEntries.get("entry-2")).resolves.toMatchObject({
      categoryId: "local-cat",
      startTime: "2026-05-07T11:00:00.000Z",
      endTime: "2026-05-07T12:00:00.000Z",
      note: "本机较新记录",
    });
  });

  it("repair 遇到分类树内 pending 时整棵树保持不动", async () => {
    await db.categories.bulkAdd([
      {
        id: "repair-root",
        name: "父分类",
        parentId: null,
        color: "#64748b",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-07T08:00:00.000Z",
        updatedAt: "2026-05-07T08:00:00.000Z",
      },
      {
        id: "repair-child",
        name: "子分类",
        parentId: "repair-root",
        color: "#22c55e",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-07T08:00:00.000Z",
        updatedAt: "2026-05-07T09:00:00.000Z",
      },
    ]);
    await db.timeEntries.add({
      id: "repair-entry",
      categoryId: "repair-child",
      startTime: "2026-05-07T10:00:00.000Z",
      endTime: "2026-05-07T11:00:00.000Z",
      note: "本地待同步",
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    await db.syncLog.add({
      id: "repair-entry-pending",
      tableName: "time_entries",
      recordId: "repair-entry",
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      latestSeq: 3,
      nextSinceSeq: 3,
      hasMore: false,
      changes: [
        {
          tableName: "categories",
          recordId: "repair-root",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T13:00:00.000Z",
        },
        {
          tableName: "time_entries",
          recordId: "repair-entry",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T13:00:00.000Z",
        },
        {
          tableName: "categories",
          recordId: "repair-child",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T13:00:00.000Z",
        },
      ],
    });

    await expect(syncPull({ mode: "repair" })).resolves.toBe(0);

    await expect(db.categories.get("repair-root")).resolves.toMatchObject({ id: "repair-root" });
    await expect(db.categories.get("repair-child")).resolves.toMatchObject({ id: "repair-child" });
    await expect(db.timeEntries.get("repair-entry")).resolves.toMatchObject({ note: "本地待同步" });
    await expect(db.syncLog.get("repair-entry-pending")).resolves.toMatchObject({ synced: 0 });
  });
});

function categoryChange(recordId: string, timestamp: string) {
  return {
    tableName: "categories" as const,
    recordId,
    action: "update" as const,
    data: {
      id: recordId,
      name: recordId,
      parentId: null,
      color: "#ff0000",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: timestamp,
    },
    timestamp,
  };
}

describe("pull 分批拉取", () => {
  it("分批拉取：逐批推进游标，全部 apply，末批收尾到 latestSeq", async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        serverTime: "2026-05-07T13:00:00.000Z",
        latestSeq: 3,
        nextSinceSeq: 2,
        hasMore: true,
        changes: [
          categoryChange("cat-1", "2026-05-07T09:00:00.000Z"),
          categoryChange("cat-2", "2026-05-07T09:01:00.000Z"),
        ],
      })
      .mockResolvedValueOnce({
        serverTime: "2026-05-07T13:00:01.000Z",
        latestSeq: 3,
        nextSinceSeq: 3,
        hasMore: false,
        changes: [
          categoryChange("cat-3", "2026-05-07T09:02:00.000Z"),
        ],
      });

    await syncPull();

    await expect(db.categories.count()).resolves.toBe(3);
    expect(getLastSyncedSeq()).toBe(3);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 0, limit: 500 }),
      hedge: { delayMs: SYNC_HEDGE_DELAY_MS },
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 2, limit: 500 }),
      hedge: { delayMs: SYNC_HEDGE_DELAY_MS },
    });
  });

  it("分批中途失败：游标停在已成功批次，可从断点续传", async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        serverTime: "2026-05-07T13:00:00.000Z",
        latestSeq: 3,
        nextSinceSeq: 2,
        hasMore: true,
        changes: [
          categoryChange("cat-1", "2026-05-07T09:00:00.000Z"),
          categoryChange("cat-2", "2026-05-07T09:01:00.000Z"),
        ],
      })
      .mockRejectedValueOnce(new Error("boom"));

    await expect(syncPull()).rejects.toThrow("boom");

    expect(getLastSyncedSeq()).toBe(2); // 只推进到批1，不跳到 latestSeq(3)
    await expect(db.categories.count()).resolves.toBe(2);
  });

  it("单批（hasMore=false）等价现状：一次请求拉完", async () => {
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-05-07T13:00:00.000Z",
      latestSeq: 1,
      nextSinceSeq: 1,
      hasMore: false,
      changes: [
        categoryChange("cat-1", "2026-05-07T09:00:00.000Z"),
      ],
    });

    await syncPull();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(getLastSyncedSeq()).toBe(1);
  });

  it("分批 pull 在途新增的本地 pending 编辑不被后续批次远端静默覆盖（每批刷新保护映射）", async () => {
    // 本地已有 cat-x（无 pending），旧时间戳
    await db.categories.add(categoryChange("cat-x", "2026-05-07T08:00:00.000Z").data);
    setLastSyncedSeq(0);

    let call = 0;
    apiFetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          serverTime: "2026-05-07T13:00:00.000Z",
          latestSeq: 2,
          nextSinceSeq: 1,
          hasMore: true,
          changes: [categoryChange("cat-other", "2026-05-07T09:00:00.000Z")],
        };
      }
      // 第二批 fetch 前：模拟 pull 在途中用户在本地改了 cat-x（新增 pending + 本地更新）
      await db.syncLog.add({
        id: "log-catx-inflight",
        tableName: "categories",
        recordId: "cat-x",
        action: "update",
        timestamp: "2026-05-07T12:00:00.000Z",
        synced: 0,
      });
      await db.categories.update("cat-x", { updatedAt: "2026-05-07T12:00:00.000Z" });
      return {
        serverTime: "2026-05-07T13:00:01.000Z",
        latestSeq: 2,
        nextSinceSeq: 2,
        hasMore: false,
        changes: [categoryChange("cat-x", "2026-05-07T10:00:00.000Z")], // 远端不同 updatedAt
      };
    });

    const { conflicts } = await syncPullSinceSeq();

    // cat-x 在途新增 pending + 远端 update + updatedAt 不同 → manual 域应挂冲突，不静默覆盖
    expect(conflicts.some((c) => c.recordId === "cat-x")).toBe(true);
    // 本地 cat-x 保留在途编辑（12:00），未被远端 10:00 覆盖
    expect((await db.categories.get("cat-x"))?.updatedAt).toBe("2026-05-07T12:00:00.000Z");
  });

  it("分类级联冲突跨页保持保护，后续页的子分类和记录墓碑不会先删本地数据", async () => {
    await db.categories.bulkAdd([
      {
        id: "tree-root",
        name: "父分类",
        parentId: null,
        color: "#64748b",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-07T08:00:00.000Z",
        updatedAt: "2026-05-07T08:00:00.000Z",
      },
      {
        id: "tree-child",
        name: "子分类",
        parentId: "tree-root",
        color: "#22c55e",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-07T08:00:00.000Z",
        updatedAt: "2026-05-07T09:00:00.000Z",
      },
    ]);
    await db.timeEntries.add({
      id: "tree-entry",
      categoryId: "tree-child",
      startTime: "2026-05-07T10:00:00.000Z",
      endTime: "2026-05-07T11:00:00.000Z",
      note: "本地待同步",
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    await db.syncLog.add({
      id: "tree-entry-pending",
      tableName: "time_entries",
      recordId: "tree-entry",
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: 0,
    });

    apiFetchMock
      .mockResolvedValueOnce({
        serverTime: "2026-05-07T13:00:00.000Z",
        latestSeq: 3,
        nextSinceSeq: 1,
        hasMore: true,
        changes: [{
          tableName: "categories",
          recordId: "tree-root",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T13:00:00.000Z",
        }],
      })
      .mockResolvedValueOnce({
        serverTime: "2026-05-07T13:00:01.000Z",
        latestSeq: 3,
        nextSinceSeq: 3,
        hasMore: false,
        changes: [
          {
            tableName: "time_entries",
            recordId: "tree-entry",
            action: "delete",
            data: null,
            timestamp: "2026-05-07T13:00:00.000Z",
          },
          {
            tableName: "categories",
            recordId: "tree-child",
            action: "delete",
            data: null,
            timestamp: "2026-05-07T13:00:00.000Z",
          },
        ],
      });

    const result = await syncPullSinceSeq();

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    await expect(db.categories.get("tree-root")).resolves.toMatchObject({ id: "tree-root" });
    await expect(db.categories.get("tree-child")).resolves.toMatchObject({ id: "tree-child" });
    await expect(db.timeEntries.get("tree-entry")).resolves.toMatchObject({ note: "本地待同步" });
    await expect(db.syncLog.get("tree-entry-pending")).resolves.toMatchObject({ synced: 0 });
  });

  // 批间让出的“继续拉下一批”行为已由上面的多批用例（真 timers）覆盖；
  // 这里只针对 yieldToMainThread 纯函数验证“异步 setTimeout(0) 让出”语义——
  // 不触碰 Dexie，故 fake timers 只冻结这一行 setTimeout，绝不会挂起 fake-indexeddb。
  it("yieldToMainThread 经 setTimeout(0) 在下一个宏任务才 resolve（异步让出而非同步）", async () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const pending = yieldToMainThread().then(settled);

      await Promise.resolve(); // flush 微任务：证明未同步 resolve
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(0); // 推进一个宏任务
      await pending;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("syncPullSinceSeq", () => {
  it("uses seq cursor for recent pulls when available", async () => {
    setLastSyncedSeq(31);
    apiFetchMock.mockResolvedValue({ serverTime: "2026-05-07T13:00:00.000Z", latestSeq: 33, changes: [] });

    await syncPullSinceSeq();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 31, limit: 500 }),
      hedge: { delayMs: SYNC_HEDGE_DELAY_MS },
    });
    expect(getLastSyncedSeq()).toBe(33);
  });


  it("applies remote settings unless the same key has a pending local change", async () => {
    await db.settings.add({ key: "sleep.categoryId", value: "local-cat", updatedAt: "2026-05-30T00:00:00.000Z" });
    await db.syncLog.add({
      id: "setting-log-1",
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "update",
      timestamp: "2026-05-30T00:30:00.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-05-30T01:00:00.000Z",
      changes: [
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "update",
          data: { key: "sleep.categoryId", value: "remote-cat", updatedAt: "2026-05-30T01:00:00.000Z" },
          timestamp: "2026-05-30T01:00:00.000Z",
        },
      ],
    });

    await expect(syncPullSinceSeq()).resolves.toMatchObject({ applied: 0, conflicts: [] });
    await expect(db.settings.get("sleep.categoryId")).resolves.toMatchObject({ value: "local-cat" });

    await db.syncLog.clear();
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-05-30T02:00:00.000Z",
      changes: [
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "update",
          data: { key: "sleep.categoryId", value: "remote-cat", updatedAt: "2026-05-30T02:00:00.000Z" },
          timestamp: "2026-05-30T02:00:00.000Z",
        },
      ],
    });

    await expect(syncPullSinceSeq()).resolves.toMatchObject({ applied: 1, conflicts: [] });
    await expect(db.settings.get("sleep.categoryId")).resolves.toMatchObject({ value: "remote-cat" });
  });

  it("applies remote quick notes unless the same note has a pending local change", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "local",
      occurredAt: "2026-06-01T04:01:30.123Z",
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    });
    await db.syncLog.add({
      id: "note-log-1",
      tableName: "quick_notes",
      recordId: "note-1",
      action: "update",
      timestamp: "2026-06-01T04:02:30.000Z",
      synced: 0,
    });
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:03:00.000Z",
      changes: [
        {
          tableName: "quick_notes",
          recordId: "note-1",
          action: "update",
          data: {
            id: "note-1",
            text: "remote",
            occurredAt: "2026-06-01T04:01:30.123Z",
            createdAt: "2026-06-01T04:02:00.000Z",
            updatedAt: "2026-06-01T04:03:00.000Z",
          },
          timestamp: "2026-06-01T04:03:00.000Z",
        },
      ],
    });

    await expect(syncPullSinceSeq()).resolves.toMatchObject({ applied: 0, conflicts: [] });
    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({ text: "local" });

    await db.syncLog.clear();
    apiFetchMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T04:04:00.000Z",
      changes: [
        {
          tableName: "quick_notes",
          recordId: "note-1",
          action: "update",
          data: {
            id: "note-1",
            text: "remote",
            occurredAt: "2026-06-01T04:01:30.123Z",
            createdAt: "2026-06-01T04:02:00.000Z",
            updatedAt: "2026-06-01T04:04:00.000Z",
          },
          timestamp: "2026-06-01T04:04:00.000Z",
        },
      ],
    });

    await expect(syncPullSinceSeq()).resolves.toMatchObject({ applied: 1, conflicts: [] });
    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({ text: "remote" });
  });

  it("detects conflicts only when local has unsynced changes", async () => {
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-local",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "local version",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });

    await db.syncLog.add({
      id: "log-1",
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: 0,
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-1",
          action: "update",
          data: {
            id: "entry-1",
            categoryId: "cat-remote",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T11:00:00.000Z",
            note: "remote version",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T12:30:00.000Z",
          },
          timestamp: "2026-05-07T12:30:00.000Z",
        },
      ],
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      tableName: "time_entries",
      recordId: "entry-1",
    });
    expect(result.applied).toBe(0);
    await expect(db.timeEntries.get("entry-1")).resolves.toMatchObject({
      categoryId: "cat-local",
    });
  });

  it("auto-applies server version when local has no unsynced changes", async () => {
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-old",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "old local",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:00:00.000Z",
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-1",
          action: "update",
          data: {
            id: "entry-1",
            categoryId: "cat-updated",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T11:00:00.000Z",
            note: "updated from other device",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T12:00:00.000Z",
          },
          timestamp: "2026-05-07T12:00:00.000Z",
        },
      ],
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(1);
    await expect(db.timeEntries.get("entry-1")).resolves.toMatchObject({
      categoryId: "cat-updated",
      note: "updated from other device",
    });
  });

  it("applies new entries that don't exist locally", async () => {
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-new",
          action: "update",
          data: {
            id: "entry-new",
            categoryId: "cat-1",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "from server",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(1);
    await expect(db.timeEntries.get("entry-new")).resolves.toMatchObject({
      categoryId: "cat-1",
    });
  });

  it("does not flag conflict when local and remote have same updatedAt", async () => {
    await db.timeEntries.add({
      id: "entry-same",
      categoryId: "cat-1",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "same",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:30:00.000Z",
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-same",
          action: "update",
          data: {
            id: "entry-same",
            categoryId: "cat-1",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "same",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:30:00.000Z",
          },
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(0);
  });

  it("keeps local entry and reports conflict when remote delete meets pending local entry update", async () => {
    await db.timeEntries.add({
      id: "entry-delete-conflict",
      categoryId: "cat-local",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "local pending",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    await db.syncLog.add({
      id: "log-entry-delete-conflict",
      tableName: "time_entries",
      recordId: "entry-delete-conflict",
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: 0,
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [{
        tableName: "time_entries",
        recordId: "entry-delete-conflict",
        action: "delete",
        data: null,
        timestamp: "2026-05-07T12:30:00.000Z",
      }],
    });

    const result = await syncPullSinceSeq();

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      tableName: "time_entries",
      recordId: "entry-delete-conflict",
      remote: null,
      remoteAction: "delete",
    });
    await expect(db.timeEntries.get("entry-delete-conflict")).resolves.toMatchObject({
      note: "local pending",
    });
  });

  it("deletes local entry when remote delete has no pending local change", async () => {
    await db.timeEntries.add({
      id: "entry-remote-deleted",
      categoryId: "cat-local",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "already synced",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:00:00.000Z",
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [{
        tableName: "time_entries",
        recordId: "entry-remote-deleted",
        action: "delete",
        data: null,
        timestamp: "2026-05-07T12:30:00.000Z",
      }],
    });

    const result = await syncPullSinceSeq();

    expect(result.applied).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    await expect(db.timeEntries.get("entry-remote-deleted")).resolves.toBeUndefined();
  });

  it("does not count repeated tombstones as applied during recent pull", async () => {
    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      changes: [
        {
          tableName: "time_entries",
          recordId: "entry-deleted",
          action: "delete",
          data: null,
          timestamp: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(0);
  });

  it("applies remote category delete during recent pull", async () => {
    await db.categories.bulkAdd([
      {
        id: "work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code",
        name: "编码",
        parentId: "work",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "life",
        name: "生活",
        parentId: null,
        color: "#22C55E",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ]);
    await db.timeEntries.bulkAdd([
      {
        id: "entry-1",
        categoryId: "work-code",
        startTime: "2026-05-08T08:00:00",
        endTime: "2026-05-08T09:00:00",
        note: null,
        createdAt: "2026-05-08T08:00:00",
        updatedAt: "2026-05-08T08:00:00",
      },
      {
        id: "entry-2",
        categoryId: "life",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
    ]);

    apiFetchMock.mockResolvedValue({
      changes: [{
        tableName: "categories",
        recordId: "work",
        action: "delete",
        data: null,
        timestamp: "2026-05-08T12:00:00.000Z",
      }],
      serverTime: "2026-05-08T12:00:00.000Z",
      latestSeq: 9,
    });

    const result = await syncPullSinceSeq();

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(3);
    await expect(db.categories.get("work")).resolves.toBeUndefined();
    await expect(db.categories.get("work-code")).resolves.toBeUndefined();
    await expect(db.categories.get("life")).resolves.toMatchObject({ id: "life" });
    await expect(db.timeEntries.get("entry-1")).resolves.toBeUndefined();
    await expect(db.timeEntries.get("entry-2")).resolves.toMatchObject({ id: "entry-2" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
  it("keeps local category tree and reports conflict when remote category delete impacts pending local changes", async () => {
    await db.categories.bulkAdd([
      {
        id: "work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      {
        id: "work-code",
        name: "编码",
        parentId: "work",
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T01:00:00.000Z",
      },
    ]);
    await db.syncLog.add({
      id: "log-work-code",
      tableName: "categories",
      recordId: "work-code",
      action: "update",
      timestamp: "2026-05-08T01:00:00.000Z",
      synced: 0,
    });

    apiFetchMock.mockResolvedValue({
      changes: [{
        tableName: "categories",
        recordId: "work",
        action: "delete",
        data: null,
        timestamp: "2026-05-08T12:00:00.000Z",
      }],
      serverTime: "2026-05-08T12:00:00.000Z",
      latestSeq: 9,
    });

    const result = await syncPullSinceSeq();

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      tableName: "categories",
      recordId: "work",
      remote: null,
      remoteAction: "delete",
    });
    await expect(db.categories.get("work")).resolves.toMatchObject({ id: "work" });
    await expect(db.categories.get("work-code")).resolves.toMatchObject({ id: "work-code" });
  });
});

describe("canSkipEchoPull", () => {
  const base = { accepted: 1, rejected: 0, conflicts: 0, issues: [], clientBugIssues: [], userActionableIssues: [] };

  it("无插队（latestSeq − baseSeq === appliedCount）且干净 → 可跳过", () => {
    expect(canSkipEchoPull({ ...base, baseSeq: 5, serverLatestSeq: 6, appliedCount: 1 })).toBe(true);
  });

  it("有插队（差值 > appliedCount）→ 不可跳过", () => {
    expect(canSkipEchoPull({ ...base, baseSeq: 5, serverLatestSeq: 8, appliedCount: 1 })).toBe(false);
  });

  it("旧 server（seq 字段缺失）→ 不可跳过（回退 pull）", () => {
    expect(canSkipEchoPull({ ...base, baseSeq: 5, serverLatestSeq: null, appliedCount: null })).toBe(false);
  });

  it("baseSeq 为 null（从未同步）→ 不可跳过", () => {
    expect(canSkipEchoPull({ ...base, baseSeq: null, serverLatestSeq: 3, appliedCount: 3 })).toBe(false);
  });

  it("push 含 conflict → 一律 pull（双保险）", () => {
    expect(canSkipEchoPull({ ...base, conflicts: 1, baseSeq: 5, serverLatestSeq: 6, appliedCount: 1 })).toBe(false);
  });

  it("push 含 rejected/issues → 一律 pull", () => {
    expect(canSkipEchoPull({ ...base, rejected: 1, issues: [{} as never], baseSeq: 5, serverLatestSeq: 6, appliedCount: 1 })).toBe(false);
  });
});

describe("regularSync", () => {
  it("deduplicates concurrent regularSync calls in one browser context", async () => {
    const fetchCalls: string[] = [];
    apiFetchMock.mockImplementation(async (url: string) => {
      fetchCalls.push(url.toString());
      if (url.toString().endsWith("/api/sync/status")) {
        return { categoryCount: 0, entryCount: 0, lastUpdatedAt: null, latestSeq: 1, serverTime: "2026-05-17T00:00:00.000Z", contentHash: "empty" };
      }
      if (url.toString().endsWith("/api/sync/pull")) {
        return { changes: [], serverTime: "2026-05-17T00:00:01.000Z", latestSeq: 1 };
      }
      return { outcomes: [], accepted: 0, rejected: 0, conflicts: 0, backupId: null, serverTime: "2026-05-17T00:00:01.000Z" };
    });

    await Promise.all([regularSync(), regularSync()]);

    expect(fetchCalls.filter((url) => url.endsWith("/api/sync/status"))).toHaveLength(1);
  });

  it("pull 与 status 请求携带对冲选项", async () => {
    // 无 pending：走 status→pull 路径（对齐上方 no-op/catchup 用例的准备方式）。
    apiFetchMock
      .mockResolvedValueOnce({
        categoryCount: 0,
        entryCount: 0,
        quickNoteCount: 0,
        lastUpdatedAt: null,
        latestSeq: 5,
        serverTime: "2026-05-17T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        changes: [],
        latestSeq: 5,
        nextSinceSeq: 5,
        hasMore: false,
        serverTime: "2026-05-17T00:00:01.000Z",
      });

    await regularSync();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status", expect.objectContaining({ hedge: { delayMs: SYNC_HEDGE_DELAY_MS } }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", expect.objectContaining({ hedge: { delayMs: SYNC_HEDGE_DELAY_MS } }));
  });

  it("returns identical from meta status without pulling a full snapshot", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "match",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    setLastSyncedSeq(7);

    apiFetchMock.mockResolvedValue({
      categoryCount: 1,
      entryCount: 1,
      lastUpdatedAt: "2026-05-08T09:00:00.000Z",
      latestSeq: 7,
      serverTime: "2026-05-08T10:00:00.000Z",
    });

    const result = await regularSync();

    expect(result).toMatchObject({ identical: true, pushed: 0, pulled: 0, rejected: 0, pushConflicts: 0 });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status", { hedge: { delayMs: SYNC_HEDGE_DELAY_MS } });
    expect(apiFetchMock).not.toHaveBeenCalledWith("/api/sync/pull", expect.anything());
    expect(getLastSyncedSeq()).toBe(7);
  });

  it("does not treat note-only server changes as already aligned", async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        categoryCount: 0,
        entryCount: 0,
        quickNoteCount: 1,
        lastUpdatedAt: "2026-06-01T04:02:00.000Z",
        latestSeq: 4,
        serverTime: "2026-06-01T04:03:00.000Z",
      })
      .mockResolvedValueOnce({
        serverTime: "2026-06-01T04:04:00.000Z",
        latestSeq: 5,
        changes: [
          {
            tableName: "quick_notes",
            recordId: "note-remote",
            action: "update",
            data: {
              id: "note-remote",
              text: "repo",
              occurredAt: "2026-06-01T04:01:30.123Z",
              createdAt: "2026-06-01T04:02:00.000Z",
              updatedAt: "2026-06-01T04:02:00.000Z",
            },
            timestamp: "2026-06-01T04:02:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(result).toMatchObject({ identical: false, pulled: 1 });
    await expect(db.quickNotes.get("note-remote")).resolves.toMatchObject({ text: "repo" });
  });

  it("pulls recent changes only when meta diverges without unsynced changes", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });

    apiFetchMock
      .mockResolvedValueOnce({
        categoryCount: 1,
        entryCount: 1,
        lastUpdatedAt: "2026-05-08T09:30:00.000Z",
        latestSeq: 7,
        serverTime: "2026-05-08T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        serverTime: "2026-05-08T10:01:00.000Z",
        latestSeq: 8,
        changes: [{
          tableName: "time_entries",
          recordId: "entry-remote",
          action: "update",
          data: {
            id: "entry-remote",
            categoryId: "cat-1",
            startTime: "2026-05-08T09:00:00.000Z",
            endTime: "2026-05-08T10:00:00.000Z",
            note: "remote",
            createdAt: "2026-05-08T09:00:00.000Z",
            updatedAt: "2026-05-08T09:30:00.000Z",
          },
          timestamp: "2026-05-08T09:30:00.000Z",
        }],
      })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/status", { hedge: { delayMs: SYNC_HEDGE_DELAY_MS } });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/pull", expect.objectContaining({ method: "POST" }));
    const pullBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(pullBody.sinceSeq).toBe(0);
    expect(apiFetchMock).not.toHaveBeenCalledWith("/api/sync/push", expect.anything());
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, "/api/admin/sync-logs", expect.objectContaining({ method: "POST" }));
    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    expect(logBody[0]).toMatchObject({ action: "pull_seq_catchup", record_count: 1 });
    expect(result).toMatchObject({ identical: false, pushed: 0, pulled: 1 });
    await expect(db.timeEntries.get("entry-remote")).resolves.toMatchObject({ note: "remote" });
  });

  it("pushes unsynced changes then pulls the seq gap when the ledger diverges", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    // syncLog 的 timestamp 用当前时间，避免落在 pruneSyncedLogs 的 7 天保留窗口之外被随后清理，
    // 与本测试要验证的“push 后标记 synced”这一断言无关。
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: new Date().toISOString(), synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
      })
      .mockResolvedValueOnce({ serverTime: "2026-05-08T10:02:00.000Z", latestSeq: 5, changes: [] })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/push", expect.objectContaining({ method: "POST" }));
    const pushBody = JSON.parse(apiFetchMock.mock.calls[0][1].body as string);
    expect(pushBody.baseSeq).toBe(3);
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/pull", expect.objectContaining({ method: "POST" }));
    const pullBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(pullBody.sinceSeq).toBe(3);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).toEqual(["push", "pull_since_seq"]);
    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0, rejected: 0, pushConflicts: 0 });
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("skips the echo pull and advances the cursor directly when push reports no intervening writes", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: new Date().toISOString(), synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
        latestSeq: 4,
        appliedCount: 1,
      })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/push", expect.objectContaining({ method: "POST" }));
    expect(apiFetchMock).not.toHaveBeenCalledWith("/api/sync/pull", expect.anything());
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const logBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).toEqual(["push", "pull_skipped_no_intervening"]);
    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0, rejected: 0, pushConflicts: 0, conflicts: [] });
    expect(getLastSyncedSeq()).toBe(4);
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
  });

  it("still pulls when push reports intervening writes (server latestSeq outpaces the push batch)", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: new Date().toISOString(), synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
        latestSeq: 6,
        appliedCount: 1,
      })
      .mockResolvedValueOnce({ serverTime: "2026-05-08T10:02:00.000Z", latestSeq: 6, changes: [] })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/push", expect.objectContaining({ method: "POST" }));
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/pull", expect.objectContaining({ method: "POST" }));
    const pullBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(pullBody.sinceSeq).toBe(3);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).toEqual(["push", "pull_since_seq"]);
    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0, rejected: 0, pushConflicts: 0 });
    expect(getLastSyncedSeq()).toBe(6);
  });

  it("records phase timings and reports them when pushing then pulling", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: "2026-05-08T09:00:00.000Z", synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
      })
      .mockResolvedValueOnce({ serverTime: "2026-05-08T10:02:00.000Z", latestSeq: 5, changes: [] })
      .mockResolvedValueOnce({ ok: true });

    const phases = createPhaseRecorder();
    const result = await regularSync({ phases });

    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0 });
    expect(phases.phases.status).toBeUndefined();
    expect(Number.isInteger(phases.phases.push)).toBe(true);
    expect(phases.phases.push).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(phases.phases.pull)).toBe(true);
    expect(phases.phases.pull).toBeGreaterThanOrEqual(0);

    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    const timingEntry = logBody.find((item: { action: string }) => item.action === "phase_timings");
    expect(timingEntry).toBeDefined();
    expect(timingEntry.record_count).toBe(0);
    expect(JSON.parse(timingEntry.detail)).toMatchObject({
      push: phases.phases.push,
      pull: phases.phases.pull,
    });
    expect(JSON.parse(timingEntry.detail).status).toBeUndefined();
  });

  it("records phase timings for the pull-only catch-up path without a push entry", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });

    apiFetchMock
      .mockResolvedValueOnce({
        categoryCount: 1,
        entryCount: 1,
        lastUpdatedAt: "2026-05-08T09:30:00.000Z",
        latestSeq: 7,
        serverTime: "2026-05-08T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        serverTime: "2026-05-08T10:01:00.000Z",
        latestSeq: 8,
        changes: [{
          tableName: "time_entries",
          recordId: "entry-remote",
          action: "update",
          data: {
            id: "entry-remote",
            categoryId: "cat-1",
            startTime: "2026-05-08T09:00:00.000Z",
            endTime: "2026-05-08T10:00:00.000Z",
            note: "remote",
            createdAt: "2026-05-08T09:00:00.000Z",
            updatedAt: "2026-05-08T09:30:00.000Z",
          },
          timestamp: "2026-05-08T09:30:00.000Z",
        }],
      })
      .mockResolvedValueOnce({ ok: true });

    const phases = createPhaseRecorder();
    const result = await regularSync({ phases });

    expect(result).toMatchObject({ identical: false, pushed: 0, pulled: 1 });
    expect(phases.phases.status).toBeGreaterThanOrEqual(0);
    expect(phases.phases.pull).toBeGreaterThanOrEqual(0);
    expect(phases.phases.push).toBeUndefined();

    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    const timingEntry = logBody.find((item: { action: string }) => item.action === "phase_timings");
    expect(timingEntry).toBeDefined();
    expect(timingEntry.record_count).toBe(0);
    const detail = JSON.parse(timingEntry.detail);
    expect(detail).toMatchObject({ status: phases.phases.status, pull: phases.phases.pull });
    expect(detail.push).toBeUndefined();
  });

  it("does not add a phase_timings entry when phases is not provided", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: "2026-05-08T09:00:00.000Z", synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
      })
      .mockResolvedValueOnce({ serverTime: "2026-05-08T10:02:00.000Z", latestSeq: 5, changes: [] })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0 });
    const logBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).toEqual(["push", "pull_since_seq"]);
    expect(logBody.some((item: { action: string }) => item.action === "phase_timings")).toBe(false);
  });

  it("prune 抛错不影响同步轮结果", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: new Date().toISOString(), synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
      })
      .mockResolvedValueOnce({ serverTime: "2026-05-08T10:02:00.000Z", latestSeq: 5, changes: [] })
      .mockResolvedValueOnce({ ok: true });

    const whereSpy = vi.spyOn(db.syncLog, "where");
    whereSpy.mockImplementation((index: unknown) => {
      const real = Reflect.apply(
        Object.getPrototypeOf(db.syncLog).where as (this: unknown, ...args: unknown[]) => unknown,
        db.syncLog,
        [index],
      ) as { equals: (value: number) => unknown };
      if (index !== "synced") return real;
      return {
        equals: (value: number) => {
          if (value === 1) {
            return {
              filter: () => ({
                delete: () => Promise.reject(new Error("boom")),
              }),
            };
          }
          return real.equals(value);
        },
      };
    });

    try {
      const result = await regularSync();
      expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0 });
      expect(getConsecutiveSyncFailureCount()).toBe(0);
    } finally {
      whereSpy.mockRestore();
    }
  });

});

describe("bump 载荷就地 apply", () => {
  beforeEach(() => {
    clearBumpStash();
  });

  afterEach(() => {
    clearBumpStash();
  });

  it("游标连续：本地 apply、推游标、零网络请求", async () => {
    setLastSyncedSeq(5);
    stashBumpPayload({
      fromSeq: 5,
      latestSeq: 6,
      changes: [{
        tableName: "quick_notes",
        recordId: "note-bump",
        action: "update",
        data: {
          id: "note-bump",
          text: "from bump",
          occurredAt: "2026-07-10T00:00:00.000Z",
          createdAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        },
        timestamp: "2026-07-10T00:00:00.000Z",
      }],
    });

    // 整轮除 /api/admin/sync-logs 上报外不该再打任何同步网络请求；命中即抛，
    // 让断言失败点直接落在越界调用上，而不是事后靠调用计数猜测。
    apiFetchMock.mockImplementation((url: unknown) => {
      if (String(url).endsWith("/api/admin/sync-logs")) return Promise.resolve({ ok: true });
      throw new Error(`unexpected network call: ${url}`);
    });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/admin/sync-logs", expect.objectContaining({ method: "POST" }));
    await expect(db.quickNotes.get("note-bump")).resolves.toMatchObject({ text: "from bump" });
    expect(getLastSyncedSeq()).toBe(6);
    expect(result).toMatchObject({ pulled: 1, conflicts: [], identical: false });
  });

  it("游标不连续：清 stash、走现状 status 路径", async () => {
    setLastSyncedSeq(3);
    stashBumpPayload({ fromSeq: 5, latestSeq: 6, changes: [] });
    apiFetchMock.mockResolvedValue({
      categoryCount: 0,
      entryCount: 0,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      latestSeq: 3,
      serverTime: "2026-07-10T00:00:00.000Z",
    });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status", expect.objectContaining({ hedge: { delayMs: SYNC_HEDGE_DELAY_MS } }));
    expect(result).toMatchObject({ identical: true });

    // stash 已被 take 清空：即便游标随后恰好推进到原 stash.fromSeq，也不会补吃一次
    // 陈旧载荷——第二轮仍必须走网络判定，不能悄悄命中快路径。
    apiFetchMock.mockClear();
    setLastSyncedSeq(5);
    apiFetchMock.mockResolvedValue({
      categoryCount: 0,
      entryCount: 0,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      latestSeq: 5,
      serverTime: "2026-07-10T00:00:01.000Z",
    });

    const result2 = await regularSync();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status", expect.anything());
    expect(result2).toMatchObject({ identical: true });
  });

  it("有 pending 时不消费 stash", async () => {
    await db.categories.add({
      id: "cat-1",
      name: "Work",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    });
    await db.timeEntries.add({
      id: "entry-local",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: "local",
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    });
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: new Date().toISOString(), synced: 0 });
    setLastSyncedSeq(3);
    // 游标命中 stash.fromSeq，但有 pending：不该被快路径吃掉，必须正常走 push。
    stashBumpPayload({ fromSeq: 3, latestSeq: 4, changes: [] });

    apiFetchMock
      .mockResolvedValueOnce({
        accepted: 1,
        rejected: 0,
        conflicts: 0,
        outcomes: [{ tableName: "time_entries", recordId: "entry-local", action: "create", status: "accepted", reasonCode: "applied", message: "Applied", incomingTimestamp: "2026-05-08T09:00:00.000Z" }],
        backupId: "backup-1",
        serverTime: "2026-05-08T10:01:00.000Z",
        latestSeq: 4,
        appliedCount: 1,
      })
      .mockResolvedValueOnce({ ok: true });

    const result = await regularSync();

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/push", expect.objectContaining({ method: "POST" }));
    expect(result).toMatchObject({ pushed: 1 });
    const logBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).not.toContain("bump_payload_applied");
  });

  it("单槽覆盖：后到 bump 覆盖前一个", async () => {
    setLastSyncedSeq(5);
    stashBumpPayload({ fromSeq: 5, latestSeq: 6, changes: [] });
    stashBumpPayload({ fromSeq: 6, latestSeq: 7, changes: [] });

    apiFetchMock.mockResolvedValueOnce({
      categoryCount: 0,
      entryCount: 0,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      latestSeq: 5,
      serverTime: "2026-07-10T00:00:00.000Z",
    });

    const result = await regularSync();

    // 新 stash.fromSeq=6 与游标 5 不匹配（旧槽已被覆盖，不再是 5）→ 退化 status 路径。
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status", expect.anything());
    expect(result).toMatchObject({ identical: true });
  });

  it("apply 冲突走既有 conflicts 管道", async () => {
    await db.timeEntries.add({
      id: "entry-1",
      categoryId: "cat-local",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "local version",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    await db.syncLog.add({
      id: "log-1",
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      timestamp: "2026-05-07T12:00:00.000Z",
      synced: 0,
    });
    setLastSyncedSeq(5);
    stashBumpPayload({
      fromSeq: 5,
      latestSeq: 6,
      changes: [{
        tableName: "time_entries",
        recordId: "entry-1",
        action: "update",
        data: {
          id: "entry-1",
          categoryId: "cat-remote",
          startTime: "2026-05-07T09:00:00.000Z",
          endTime: "2026-05-07T11:00:00.000Z",
          note: "remote version",
          createdAt: "2026-05-07T08:00:00.000Z",
          updatedAt: "2026-05-07T12:30:00.000Z",
        },
        timestamp: "2026-05-07T12:30:00.000Z",
      }],
    });

    // 快路径的“无 pending”判定只看外层一次快照；真实并发下，判定通过后到
    // applyPullChangesBatch 自身事务开始前仍可能落一条新写入（引擎里就地 apply
    // 分支注释所说的这层竞态）。这里用已存在的 pending 记录复现它：外层查询打桩成
    // 0（放行进入快路径），内层事务自己重新查到的真实 pending 命中既有 conflicts 管道。
    let whereCallCount = 0;
    const whereSpy = vi.spyOn(db.syncLog, "where");
    whereSpy.mockImplementation((index: unknown) => {
      const real = Reflect.apply(
        Object.getPrototypeOf(db.syncLog).where as (this: unknown, ...args: unknown[]) => unknown,
        db.syncLog,
        [index],
      ) as { equals: (value: number) => { count: () => Promise<number> } };
      if (index !== "synced") return real;
      whereCallCount += 1;
      const isFirstCall = whereCallCount === 1;
      return {
        equals: (value: number) => {
          const collection = real.equals(value);
          if (isFirstCall) collection.count = async () => 0;
          return collection;
        },
      };
    });

    apiFetchMock.mockImplementation((url: unknown) => {
      if (String(url).endsWith("/api/admin/sync-logs")) return Promise.resolve({ ok: true });
      throw new Error(`unexpected network call: ${url}`);
    });

    try {
      const result = await regularSync();

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ tableName: "time_entries", recordId: "entry-1" });
      expect(result.pulled).toBe(0);
      await expect(db.timeEntries.get("entry-1")).resolves.toMatchObject({ categoryId: "cat-local" });
      await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 0 });
    } finally {
      whereSpy.mockRestore();
    }
  });
});

describe("syncForceReplace", () => {
  it("clears local data and replaces with server data", async () => {
    await db.timeEntries.add({
      id: "local-only",
      categoryId: "cat-1",
      startTime: "2026-05-07T09:00:00.000Z",
      endTime: "2026-05-07T10:00:00.000Z",
      note: "will be deleted",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:00:00.000Z",
    });
    await db.settings.add({ key: "sleep.categoryId", value: "local-cat", updatedAt: "2026-05-07T09:00:00.000Z" });
    await db.quickNotes.add({
      id: "note-local",
      text: "local",
      occurredAt: "2026-05-07T09:05:00.000Z",
      createdAt: "2026-05-07T09:05:00.000Z",
      updatedAt: "2026-05-07T09:05:00.000Z",
    });

    apiFetchMock.mockResolvedValue({
      serverTime: "2026-05-07T13:00:00.000Z",
      latestSeq: 42,
      changes: [
        {
          tableName: "categories",
          recordId: "cat-server",
          action: "update",
          data: {
            id: "cat-server",
            name: "Server Cat",
            parentId: null,
            color: "#ff0000",
            icon: null,
            sortOrder: 0,
            isArchived: false,
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:00:00.000Z",
          },
          timestamp: "2026-05-07T09:00:00.000Z",
        },
        {
          tableName: "time_entries",
          recordId: "entry-server",
          action: "update",
          data: {
            id: "entry-server",
            categoryId: "cat-server",
            startTime: "2026-05-07T09:00:00.000Z",
            endTime: "2026-05-07T10:00:00.000Z",
            note: "from server",
            createdAt: "2026-05-07T08:00:00.000Z",
            updatedAt: "2026-05-07T09:00:00.000Z",
          },
          timestamp: "2026-05-07T09:00:00.000Z",
        },
        {
          tableName: "settings",
          recordId: "sleep.categoryId",
          action: "update",
          data: { key: "sleep.categoryId", value: "server-cat", updatedAt: "2026-05-07T09:00:00.000Z" },
          timestamp: "2026-05-07T09:00:00.000Z",
        },
        {
          tableName: "quick_notes",
          recordId: "note-server",
          action: "update",
          data: {
            id: "note-server",
            text: "server note",
            occurredAt: "2026-05-07T09:10:00.000Z",
            createdAt: "2026-05-07T09:10:00.000Z",
            updatedAt: "2026-05-07T09:10:00.000Z",
          },
          timestamp: "2026-05-07T09:10:00.000Z",
        },
      ],
    });

    const count = await syncForceReplace();

    expect(count).toBe(4);
    await expect(db.timeEntries.get("local-only")).resolves.toBeUndefined();
    await expect(db.quickNotes.get("note-local")).resolves.toBeUndefined();
    await expect(db.timeEntries.get("entry-server")).resolves.toMatchObject({
      note: "from server",
    });
    await expect(db.categories.get("cat-server")).resolves.toMatchObject({
      name: "Server Cat",
    });
    await expect(db.settings.get("sleep.categoryId")).resolves.toMatchObject({ value: "server-cat" });
    await expect(db.quickNotes.get("note-server")).resolves.toMatchObject({ text: "server note" });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", expect.objectContaining({ timeoutMs: 30_000 }));
    expect(await db.syncLog.count()).toBe(0);
    expect(getLastSyncedSeq()).toBe(42);
  });
});

describe("compactSyncLogs", () => {
  it("keeps only the last update for repeated edits to the same record", () => {
    const compacted = compactSyncLogs([
      log("entry-1", "update", "00"),
      log("entry-1", "update", "01"),
      log("entry-1", "update", "02"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "entry-1",
      action: "update",
      timestamp: "2026-05-06T00:02:00.000Z",
    });
  });

  it("keeps different records separate", () => {
    const compacted = compactSyncLogs([
      log("entry-1", "update", "00"),
      log("entry-2", "update", "01"),
      log("entry-1", "update", "02"),
    ]);

    expect(compacted.map((entry) => entry.recordId)).toEqual(["entry-2", "entry-1"]);
  });

  it("preserves create when a new record is updated before syncing", () => {
    const compacted = compactSyncLogs([
      log("entry-1", "create", "00"),
      log("entry-1", "update", "01"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "entry-1",
      action: "create",
      timestamp: "2026-05-06T00:01:00.000Z",
    });
  });

  it("turns update followed by delete into delete", () => {
    const compacted = compactSyncLogs([
      log("entry-1", "update", "00"),
      log("entry-1", "delete", "01"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "entry-1",
      action: "delete",
    });
  });

  it("omits create followed by delete from the push payload", () => {
    const compacted = compactSyncLogs([
      log("entry-1", "create", "00"),
      log("entry-1", "delete", "01"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "entry-1",
      action: "delete",
      omitFromPush: true,
    });
  });

  it("保留组内最后一条 op，即使最后一条日志本身无 op", () => {
    const compacted = compactSyncLogs([
      {
        ...log("task-1", "update", "01", "tasks"),
        op: { type: "complete", at: "2026-05-06T00:01:00.000Z" },
      },
      log("task-1", "update", "02", "tasks"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "task-1",
      action: "update",
      timestamp: "2026-05-06T00:02:00.000Z",
      op: { type: "complete", at: "2026-05-06T00:01:00.000Z" },
    });
  });

  it("tracks 压缩保留组内最后一个 status op，后续普通 meta 更新不会吞掉状态变更", () => {
    const compacted = compactSyncLogs([
      {
        ...log("track-1", "update", "01", "tracks"),
        op: { type: "status", at: "2026-05-06T00:01:00.000Z" },
      },
      log("track-1", "update", "02", "tracks"),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "track-1",
      action: "update",
      timestamp: "2026-05-06T00:02:00.000Z",
      op: { type: "status", at: "2026-05-06T00:01:00.000Z" },
    });
  });

  it("多条 op 压缩时取时间序最后一个", () => {
    const compacted = compactSyncLogs([
      {
        ...log("task-1", "update", "01", "tasks"),
        op: { type: "complete", at: "2026-05-06T00:01:00.000Z" },
      },
      {
        ...log("task-1", "update", "02", "tasks"),
        op: { type: "reopen", at: "2026-05-06T00:02:00.000Z" },
      },
    ]);

    expect(compacted[0].op).toEqual({ type: "reopen", at: "2026-05-06T00:02:00.000Z" });
  });

  it("create 和带 op 的 update 压缩成 create 时保留 op", () => {
    const compacted = compactSyncLogs([
      log("task-1", "create", "01", "tasks"),
      {
        ...log("task-1", "update", "02", "tasks"),
        op: { type: "complete", at: "2026-05-06T00:02:00.000Z" },
      },
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      recordId: "task-1",
      action: "create",
      op: { type: "complete", at: "2026-05-06T00:02:00.000Z" },
    });
  });
});
