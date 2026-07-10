// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStreamMessage } from "../lib/syncStream.js";
import { syncScheduler } from "../sync/scheduler.ts";
import { renderDom, unmount } from "../test/domHarness.js";
import { deriveSyncStatus, SyncProvider, shouldPullForBump, useSyncContext } from "./SyncContext.js";

const mockSyncConflicts: unknown[] = [];

const syncDbMock = vi.hoisted(() => {
  const state = {
    liveUnsyncedCount: 0,
    persistedUnsyncedCount: 0,
  };
  const count = vi.fn(async () => state.persistedUnsyncedCount);
  const equals = vi.fn(() => ({ count }));
  const where = vi.fn(() => ({ equals }));
  const useLiveQuery = vi.fn(() => state.liveUnsyncedCount);

  return {
    state,
    count,
    equals,
    where,
    useLiveQuery,
    db: { syncLog: { where } },
  };
});

const syncStreamMock = vi.hoisted(() => {
  const start = vi.fn();
  const stop = vi.fn();
  let onMessage: ((message: SyncStreamMessage) => void) | null = null;
  let onStateChange: ((state: "connecting" | "connected" | "disconnected") => void) | null = null;

  return {
    start,
    stop,
    create: vi.fn(
      (options: {
        onMessage: (message: SyncStreamMessage) => void;
        onStateChange: (state: "connecting" | "connected" | "disconnected") => void;
      }) => {
        onMessage = options.onMessage;
        onStateChange = options.onStateChange;
        return { start, stop, getConnectionState: () => "disconnected" };
      },
    ),
    emit(message: SyncStreamMessage) {
      onMessage?.(message);
    },
    setState(state: "connecting" | "connected" | "disconnected") {
      onStateChange?.(state);
    },
  };
});

vi.mock("../lib/syncStream.js", () => ({
  createSyncStream: syncStreamMock.create,
}));

const mockSyncActions = {
  sync: vi.fn(),
  forceReplace: vi.fn(),
  runDiagnostics: vi.fn(),
  prepareForcePushToServer: vi.fn(),
  forcePushToServer: vi.fn(),
  handleConflictResolution: vi.fn(),
  refreshSyncStatus: vi.fn(),
};

const mockSyncState = {
  syncing: false,
  lastSynced: null,
  unsyncedCount: 0,
  error: null,
  conflicts: mockSyncConflicts,
  lastResult: null,
  healthReport: null,
  healthLoading: false,
  forcePushPreparation: null,
  syncFailureCount: 0,
  needsSyncDiagnostics: false,
  ...mockSyncActions,
};

vi.mock("../hooks/useSync.ts", () => ({
  useSync: () => mockSyncState,
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: syncDbMock.useLiveQuery,
}));

vi.mock("../db/index.ts", () => ({
  db: syncDbMock.db,
}));

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  syncDbMock.state.liveUnsyncedCount = 0;
  syncDbMock.state.persistedUnsyncedCount = 0;
  mockSyncState.syncing = false;
  mockSyncState.lastSynced = null;
  mockSyncState.error = null;
  mockSyncActions.sync.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  syncScheduler.dispose();
});

describe("deriveSyncStatus", () => {
  it("maps disabled before all runtime states", () => {
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: false,
        syncing: true,
        error: "boom",
        unsyncedCount: 1,
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("disabled");
  });

  it("maps syncing, error, success, and idle", () => {
    expect(
      deriveSyncStatus({ cloudSyncEnabled: true, syncing: true, error: null, unsyncedCount: 0, lastSynced: null }),
    ).toBe("syncing");
    expect(
      deriveSyncStatus({ cloudSyncEnabled: true, syncing: false, error: "boom", unsyncedCount: 0, lastSynced: null }),
    ).toBe("error");
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: true,
        syncing: false,
        error: null,
        unsyncedCount: 0,
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("success");
    expect(
      deriveSyncStatus({ cloudSyncEnabled: true, syncing: false, error: null, unsyncedCount: 0, lastSynced: null }),
    ).toBe("idle");
  });

  it("maps unsynced local changes to pending after syncing and error states", () => {
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: true,
        syncing: false,
        error: null,
        unsyncedCount: 1,
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("pending");
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: true,
        syncing: false,
        error: "boom",
        unsyncedCount: 1,
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("error");
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: true,
        syncing: true,
        error: "boom",
        unsyncedCount: 1,
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("syncing");
  });
});

describe("shouldPullForBump", () => {
  it("pulls when remote seq is ahead or local cursor is unset", () => {
    expect(shouldPullForBump(5, 3)).toBe(true);
    expect(shouldPullForBump(1, null)).toBe(true);
  });

  it("suppresses echoes and empty remote cursors", () => {
    expect(shouldPullForBump(3, 3)).toBe(false);
    expect(shouldPullForBump(2, 3)).toBe(false);
    expect(shouldPullForBump(null, 3)).toBe(false);
  });
});

describe("SyncProvider", () => {
  it("renders children", () => {
    const html = renderToStaticMarkup(createElement(SyncProvider, null, createElement("span", null, "child")));

    expect(html).toContain("child");
  });

  it("keeps provided value stable across unrelated parent rerenders", async () => {
    const seenValues: unknown[] = [];
    let triggerUnrelatedRerender: () => void = () => undefined;

    function Probe() {
      seenValues.push(useSyncContext());
      return createElement("span", null, "probe");
    }

    function Wrapper() {
      const [unrelated, setUnrelated] = useState(0);
      triggerUnrelatedRerender = () => setUnrelated((value) => value + 1);
      return createElement(
        SyncProvider,
        null,
        createElement("div", { "data-unrelated": unrelated }, createElement(Probe)),
      );
    }

    const { root } = await renderDom(createElement(Wrapper));

    const initialValue = seenValues.at(-1);

    await act(async () => {
      triggerUnrelatedRerender();
    });

    expect(seenValues.at(-1)).toBe(initialValue);

    await unmount(root);
  });

  it("updates api url in localStorage and context", async () => {
    let latestApiUrl = "";
    let updateApiUrl: (url: string) => void = () => undefined;

    function Probe() {
      const context = useSyncContext();
      latestApiUrl = context.apiUrl;
      updateApiUrl = context.updateApiUrl;
      return createElement("span", null, context.apiUrl || "empty");
    }

    const { root } = await renderDom(createElement(SyncProvider, null, createElement(Probe)));

    expect(latestApiUrl).toBe("");

    await act(async () => {
      updateApiUrl("https://new.example");
    });

    expect(localStorage.getItem("timedata_api_url")).toBe("https://new.example");
    expect(latestApiUrl).toBe("https://new.example");

    await unmount(root);
  });

  it("uses live unsynced count for the provided status", async () => {
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    mockSyncState.lastSynced = "2026-05-11T00:00:00.000Z";
    syncDbMock.state.liveUnsyncedCount = 2;
    syncDbMock.state.persistedUnsyncedCount = 2;
    let latestStatus = "";

    function Probe() {
      latestStatus = useSyncContext().status;
      return createElement("span", null, latestStatus);
    }

    const { root } = await renderDom(createElement(SyncProvider, null, createElement(Probe)));

    const liveQuery = syncDbMock.useLiveQuery.mock.calls.at(-1)?.[0] as (() => Promise<number>) | undefined;
    await expect(liveQuery?.()).resolves.toBe(2);
    expect(syncDbMock.where).toHaveBeenCalledWith("synced");
    expect(syncDbMock.equals).toHaveBeenCalledWith(0);
    expect(latestStatus).toBe("pending");

    await unmount(root);
  });

  it("registers an executor with the scheduler when cloud sync is enabled with an apiUrl, and unregisters on unmount", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    expect(setExecutorSpy).toHaveBeenCalledWith(expect.any(Function));

    await unmount(root);

    expect(setExecutorSpy).toHaveBeenLastCalledWith(null);
  });

  it("does not register an executor when cloud sync is disabled or apiUrl is empty", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    expect(setExecutorSpy).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("wraps the registered executor to forward meta merged with the current connection state", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    const registeredExecutor = setExecutorSpy.mock.calls.at(-1)?.[0];
    expect(registeredExecutor).toBeTypeOf("function");

    await act(async () => {
      await registeredExecutor?.({ reason: "write", waitMs: 123 });
    });

    expect(mockSyncActions.sync).toHaveBeenCalledWith({ reason: "write", waitMs: 123, connection: "disconnected" });

    await unmount(root);
  });

  it("preserves structured retry outcomes from useSync", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    mockSyncActions.sync.mockResolvedValueOnce({ ok: false, retryAfterMs: 8_000 });

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));
    const registeredExecutor = setExecutorSpy.mock.calls.at(-1)?.[0];

    let result: unknown;
    await act(async () => {
      result = await registeredExecutor?.({ reason: "bump", waitMs: 0 });
    });

    expect(result).toEqual({ ok: false, retryAfterMs: 8_000 });
    await unmount(root);
  });

  it("marks the last run as failed when the executor's sync resolves false", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    mockSyncActions.sync.mockResolvedValueOnce(false);

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    const registeredExecutor = setExecutorSpy.mock.calls.at(-1)?.[0];

    let result: boolean | undefined;
    await act(async () => {
      result = await registeredExecutor?.({ reason: "write", waitMs: 0 });
    });

    expect(result).toBe(false);

    await unmount(root);
  });

  it("requests a reconnect sync when the stream connects after a previously failed run", async () => {
    const setExecutorSpy = vi.spyOn(syncScheduler, "setExecutor");
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    mockSyncActions.sync.mockResolvedValueOnce(false);

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    const registeredExecutor = setExecutorSpy.mock.calls.at(-1)?.[0];
    await act(async () => {
      await registeredExecutor?.({ reason: "write", waitMs: 0 });
    });

    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.setState("connected");
    });

    expect(requestSyncSpy).toHaveBeenCalledWith("reconnect");

    await unmount(root);
  });

  it("does not request a reconnect sync when the previous run succeeded", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.setState("connected");
    });

    expect(requestSyncSpy).not.toHaveBeenCalledWith("reconnect");

    await unmount(root);
  });

  it("starts and stops the foreground sync stream with visibility", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    expect(syncStreamMock.create).toHaveBeenCalledTimes(1);
    expect(syncStreamMock.start).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(syncStreamMock.stop).toHaveBeenCalled();

    await unmount(root);
  });

  it("kicks a resume sync when the document becomes visible", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    requestSyncSpy.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(requestSyncSpy).toHaveBeenCalledWith("resume");

    await unmount(root);
  });

  it("flushes the scheduler when the document becomes hidden", async () => {
    const flushNowSpy = vi.spyOn(syncScheduler, "flushNow");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    flushNowSpy.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(flushNowSpy).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("forwards a remote bump ahead of the local seq cursor to scheduler.requestSync", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    localStorage.setItem("timedata_last_synced_seq", "1");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.emit({ event: "bump", data: '{"latestSeq":2}' });
    });

    expect(requestSyncSpy).toHaveBeenCalledWith("bump");

    await unmount(root);
  });

  it("forwards a hello ahead of the local seq cursor to scheduler.requestSync", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    localStorage.setItem("timedata_last_synced_seq", "3");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));
    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.emit({ event: "hello", data: '{"latestSeq":4}' });
    });

    expect(requestSyncSpy).toHaveBeenCalledWith("bump");
    await unmount(root);
  });

  it("ignores a hello at or behind the local seq cursor", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    localStorage.setItem("timedata_last_synced_seq", "3");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));
    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.emit({ event: "hello", data: '{"latestSeq":3}' });
    });

    expect(requestSyncSpy).not.toHaveBeenCalledWith("bump");
    await unmount(root);
  });

  it("ignores stream echoes at or behind the local seq cursor without calling requestSync", async () => {
    const requestSyncSpy = vi.spyOn(syncScheduler, "requestSync");
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    localStorage.setItem("timedata_last_synced_seq", "3");

    const { root } = await renderDom(createElement(SyncProvider, null, createElement("span", null, "probe")));

    requestSyncSpy.mockClear();

    await act(async () => {
      syncStreamMock.emit({ event: "bump", data: '{"latestSeq":3}' });
    });

    expect(requestSyncSpy).not.toHaveBeenCalledWith("bump");

    await unmount(root);
  });
});
