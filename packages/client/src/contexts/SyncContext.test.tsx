// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_AUTO_THROTTLE_MS,
  SyncProvider,
  deriveSyncStatus,
  shouldRunThrottledSync,
  useSyncContext,
} from "./SyncContext.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSyncConflicts: unknown[] = [];

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
  localStorage.clear();
});

describe("deriveSyncStatus", () => {
  it("maps disabled before all runtime states", () => {
    expect(
      deriveSyncStatus({
        cloudSyncEnabled: false,
        syncing: true,
        error: "boom",
        lastSynced: "2026-05-11T00:00:00.000Z",
      }),
    ).toBe("disabled");
  });

  it("maps syncing, error, success, and idle", () => {
    expect(deriveSyncStatus({ cloudSyncEnabled: true, syncing: true, error: null, lastSynced: null })).toBe("syncing");
    expect(deriveSyncStatus({ cloudSyncEnabled: true, syncing: false, error: "boom", lastSynced: null })).toBe("error");
    expect(
      deriveSyncStatus({ cloudSyncEnabled: true, syncing: false, error: null, lastSynced: "2026-05-11T00:00:00.000Z" }),
    ).toBe("success");
    expect(deriveSyncStatus({ cloudSyncEnabled: true, syncing: false, error: null, lastSynced: null })).toBe("idle");
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
});
