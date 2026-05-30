// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSyncStatus,
  SYNC_AUTO_THROTTLE_MS,
  SyncProvider,
  shouldRunThrottledSync,
  useSyncContext,
} from "./SyncContext.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  syncDbMock.state.liveUnsyncedCount = 0;
  syncDbMock.state.persistedUnsyncedCount = 0;
  mockSyncState.syncing = false;
  mockSyncState.lastSynced = null;
  mockSyncState.error = null;
  mockSyncActions.sync.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
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

describe("shouldRunThrottledSync", () => {
  it("blocks disabled and in-flight sync", () => {
    expect(shouldRunThrottledSync({ cloudSyncEnabled: false, syncing: false, now: 1000, lastAttemptAt: 0 })).toBe(
      false,
    );
    expect(shouldRunThrottledSync({ cloudSyncEnabled: true, syncing: true, now: 1000, lastAttemptAt: 0 })).toBe(false);
  });

  it("allows the first enabled sync and throttles the next attempt", () => {
    expect(shouldRunThrottledSync({ cloudSyncEnabled: true, syncing: false, now: 1000, lastAttemptAt: null })).toBe(
      true,
    );
    expect(
      shouldRunThrottledSync({
        cloudSyncEnabled: true,
        syncing: false,
        now: 1000 + SYNC_AUTO_THROTTLE_MS - 1,
        lastAttemptAt: 1000,
      }),
    ).toBe(false);
    expect(
      shouldRunThrottledSync({
        cloudSyncEnabled: true,
        syncing: false,
        now: 1000 + SYNC_AUTO_THROTTLE_MS,
        lastAttemptAt: 1000,
      }),
    ).toBe(true);
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

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(Wrapper));
    });

    const initialValue = seenValues.at(-1);

    await act(async () => {
      triggerUnrelatedRerender();
    });

    expect(seenValues.at(-1)).toBe(initialValue);

    await act(async () => {
      root.unmount();
    });
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

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SyncProvider, null, createElement(Probe)));
    });

    expect(latestApiUrl).toBe("");

    await act(async () => {
      updateApiUrl("https://new.example");
    });

    expect(localStorage.getItem("timedata_api_url")).toBe("https://new.example");
    expect(latestApiUrl).toBe("https://new.example");

    await act(async () => {
      root.unmount();
    });
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

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SyncProvider, null, createElement(Probe)));
    });

    const liveQuery = syncDbMock.useLiveQuery.mock.calls.at(-1)?.[0] as (() => Promise<number>) | undefined;
    await expect(liveQuery?.()).resolves.toBe(2);
    expect(syncDbMock.where).toHaveBeenCalledWith("synced");
    expect(syncDbMock.equals).toHaveBeenCalledWith(0);
    expect(latestStatus).toBe("pending");

    await act(async () => {
      root.unmount();
    });
  });

  it("flushes a throttled auto sync once at the end of the throttle window when changes remain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    syncDbMock.state.persistedUnsyncedCount = 1;
    let syncIfStale: () => Promise<void> = async () => undefined;

    function Probe() {
      syncIfStale = useSyncContext().syncIfStale;
      return createElement("span", null, "probe");
    }

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SyncProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await syncIfStale();
    });

    expect(mockSyncActions.sync).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1100);
    await act(async () => {
      await syncIfStale();
      await syncIfStale();
    });

    expect(mockSyncActions.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_AUTO_THROTTLE_MS - 101);
    });
    expect(mockSyncActions.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockSyncActions.sync).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("skips a throttled flush when no unsynced changes remain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    let syncIfStale: () => Promise<void> = async () => undefined;

    function Probe() {
      syncIfStale = useSyncContext().syncIfStale;
      return createElement("span", null, "probe");
    }

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SyncProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await syncIfStale();
    });

    syncDbMock.state.persistedUnsyncedCount = 0;
    vi.setSystemTime(1100);
    await act(async () => {
      await syncIfStale();
      await vi.advanceTimersByTimeAsync(SYNC_AUTO_THROTTLE_MS - 100);
    });

    expect(mockSyncActions.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("clears a delayed throttled flush on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    syncDbMock.state.persistedUnsyncedCount = 1;
    let syncIfStale: () => Promise<void> = async () => undefined;

    function Probe() {
      syncIfStale = useSyncContext().syncIfStale;
      return createElement("span", null, "probe");
    }

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SyncProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await syncIfStale();
    });

    vi.setSystemTime(1100);
    await act(async () => {
      await syncIfStale();
      root.unmount();
      await vi.advanceTimersByTimeAsync(SYNC_AUTO_THROTTLE_MS);
    });

    expect(mockSyncActions.sync).toHaveBeenCalledTimes(1);
  });
});
