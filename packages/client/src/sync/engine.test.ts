import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickNote, SyncLogEntry } from "@timedata/shared";
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

import { advanceSeqCursor, compactSyncLogs, getConsecutiveSyncFailureCount, getLastSyncedSeq, getSyncHealth, localContentHash, prepareForcePush, recordRegularSyncFailure, recordSyncLog, regularSync, resetConsecutiveSyncFailures, setLastSyncedSeq, shouldOpenSyncDiagnostics, syncForcePushToServer, syncPush, syncPull, syncPullSinceSeq, syncForceReplace } from "./engine.js";

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
  it("prepares then uploads all local data and clears local syncLog", async () => {
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
    await db.settings.add({ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-08T08:30:00.000Z" });
    await db.quickNotes.add({
      id: "note-1",
      text: "repo",
      occurredAt: "2026-05-08T08:40:00.000Z",
      createdAt: "2026-05-08T08:40:00.000Z",
      updatedAt: "2026-05-08T08:40:00.000Z",
    });

    apiFetchMock
      .mockResolvedValueOnce({
        confirmToken: "token-1",
        expiresAt: "2026-05-08T12:05:00.000Z",
        confirmationPhrase: "OVERWRITE_SERVER",
        serverStatus: { categoryCount: 0, entryCount: 0, quickNoteCount: 0, lastUpdatedAt: null, serverTime: "2026-05-08T12:00:00.000Z" },
      })
      .mockResolvedValueOnce({
        importedCategories: 1,
        importedTimeEntries: 1,
        importedQuickNotes: 1,
        backupId: "sync_force_push-1",
        serverTime: "2026-05-08T12:01:00.000Z",
        latestSeq: 42,
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
    expect(result).toMatchObject({ importedCategories: 1, importedTimeEntries: 1, importedQuickNotes: 1, backupId: "sync_force_push-1" });
    expect(await db.syncLog.count()).toBe(0);
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

  it("handles 409 push outcomes without losing accepted sync logs", async () => {
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
    apiFetchMock.mockRejectedValue(error);

    const result = await syncPush();

    expect(result).toMatchObject({ accepted: 1, rejected: 0, conflicts: 1, issues: [expect.objectContaining({ recordId: "entry-conflict", reasonCode: "overlap" })] });
    await expect(db.syncLog.get(acceptedLogId)).resolves.toMatchObject({ synced: 1 });
    await expect(db.syncLog.get(conflictLogId)).resolves.toMatchObject({ synced: 0 });
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
      body: JSON.stringify({ sinceSeq: 21 }),
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
      body: JSON.stringify({ sinceSeq: 0 }),
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
});

describe("syncPullSinceSeq", () => {
  it("uses seq cursor for recent pulls when available", async () => {
    setLastSyncedSeq(31);
    apiFetchMock.mockResolvedValue({ serverTime: "2026-05-07T13:00:00.000Z", latestSeq: 33, changes: [] });

    await syncPullSinceSeq();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ sinceSeq: 31 }),
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
      synced: false,
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
      synced: false,
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

  it("runs a separate sync when a concurrent call needs beforeMutating", async () => {
    setLastSyncedSeq(1);
    let releaseStatus: (() => void) | null = null;
    const firstStatus = new Promise((resolve) => {
      releaseStatus = () => resolve({ categoryCount: 0, entryCount: 0, lastUpdatedAt: null, latestSeq: 1, serverTime: "2026-05-17T00:00:00.000Z" });
    });
    apiFetchMock
      .mockReturnValueOnce(firstStatus)
      .mockResolvedValueOnce({ categoryCount: 0, entryCount: 1, lastUpdatedAt: "2026-05-17T00:00:00.000Z", latestSeq: 2, serverTime: "2026-05-17T00:00:01.000Z" })
      .mockResolvedValueOnce({ changes: [], serverTime: "2026-05-17T00:00:02.000Z", latestSeq: 2 })
      .mockResolvedValueOnce({ ok: true });

    const first = regularSync();
    const beforeMutating = vi.fn().mockResolvedValue(undefined);
    const second = regularSync({ beforeMutating });
    releaseStatus?.();
    await Promise.all([first, second]);

    expect(beforeMutating).toHaveBeenCalledOnce();
    expect(apiFetchMock.mock.calls.filter(([url]) => url === "/api/sync/status")).toHaveLength(2);
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

    const beforeMutating = vi.fn();
    const result = await regularSync({ beforeMutating });

    expect(result).toMatchObject({ identical: true, pushed: 0, pulled: 0, rejected: 0, pushConflicts: 0 });
    expect(beforeMutating).not.toHaveBeenCalled();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/sync/status");
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

    const result = await regularSync({ beforeMutating: vi.fn().mockResolvedValue(undefined) });

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

    const beforeMutating = vi.fn().mockResolvedValue(undefined);
    const result = await regularSync({ beforeMutating });

    expect(beforeMutating).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/status");
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/pull", expect.objectContaining({ method: "POST" }));
    const pullBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(pullBody.sinceSeq).toBe(0);
    expect(apiFetchMock).not.toHaveBeenCalledWith("/api/sync/push", expect.anything());
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, "/api/sync-logs", expect.objectContaining({ method: "POST" }));
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
    await db.syncLog.add({ id: "log-1", tableName: "time_entries", recordId: "entry-local", action: "create", timestamp: "2026-05-08T09:00:00.000Z", synced: 0 });
    setLastSyncedSeq(3);

    apiFetchMock
      .mockResolvedValueOnce({
        categoryCount: 1,
        entryCount: 0,
        lastUpdatedAt: "2026-05-08T08:00:00.000Z",
        latestSeq: 4,
        serverTime: "2026-05-08T10:00:00.000Z",
      })
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

    const beforeMutating = vi.fn().mockResolvedValue(undefined);
    const result = await regularSync({ beforeMutating });

    expect(beforeMutating).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/sync/status");
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/sync/push", expect.objectContaining({ method: "POST" }));
    const pushBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string);
    expect(pushBody.baseSeq).toBe(3);
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, "/api/sync/pull", expect.objectContaining({ method: "POST" }));
    const pullBody = JSON.parse(apiFetchMock.mock.calls[2][1].body as string);
    expect(pullBody.sinceSeq).toBe(3);
    const logBody = JSON.parse(apiFetchMock.mock.calls[3][1].body as string);
    expect(logBody.map((item: { action: string }) => item.action)).toEqual(["push", "pull_since_seq"]);
    expect(result).toMatchObject({ identical: false, pushed: 1, pulled: 0, rejected: 0, pushConflicts: 0 });
    await expect(db.syncLog.get("log-1")).resolves.toMatchObject({ synced: 1 });
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
});
