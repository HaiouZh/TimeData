import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerConnectionState } from "./SettingsPage.js";
import SettingsPage from "./SettingsPage.js";

const useSyncContextMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: useSyncContextMock,
}));

function defaultSyncState() {
  return {
    syncing: false,
    lastSynced: "2026-05-08T08:00:00.000Z",
    unsyncedCount: 2,
    error: null,
    conflicts: [],
    lastResult: { checked: true, identical: false, backupCreated: true, pushed: 1, rejected: 0, pushConflicts: 0, pushIssues: [], pulled: 3, conflicts: [] },
    apiUrl: localStorage.getItem("timedata_api_url") || "",
    updateApiUrl: vi.fn(),
    cloudSyncEnabled: true,
    sync: vi.fn(),
    forceReplace: vi.fn(),
    handleConflictResolution: vi.fn(),
    refreshSyncStatus: vi.fn(),
  };
}

vi.mock("../lib/serverVersion.ts", () => ({
  fetchServerVersion: vi.fn(async () => ({
    current: "abc1234",
    latest: "def5678",
    hasUpdate: true,
    checkedAt: "2026-05-08T08:00:00.000Z",
  })),
  triggerServerUpdate: vi.fn(),
  fetchUpdateStatus: vi.fn(),
}));

vi.mock("../lib/mobileUpdate.ts", () => ({
  fetchAndroidApkUpdate: vi.fn(),
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

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    useSyncContextMock.mockReturnValue(defaultSyncState());
  });

  it("reflects apiUrl updates from sync context", () => {
    localStorage.clear();
    useSyncContextMock.mockReturnValue({
      ...defaultSyncState(),
      apiUrl: "https://new.example",
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("正在检查服务器");
    expect(html).not.toContain("未配置服务器");
  });

  it("renders the target horizontal settings entries", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("服务器配置");
    expect(html).toContain("href=\"/settings/server\"");
    expect(html).toContain("数据设置");
    expect(html).toContain("href=\"/settings/data\"");
    expect(html).toContain("服务端数据洞察");
    expect(html).toContain("href=\"/settings/admin-insights\"");
    expect(html).toContain("APK 更新");
    expect(html).toContain("服务端更新");
  });

  it("shows sync summary between server and data entries when cloud sync is enabled", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));
    const serverIndex = html.indexOf("服务器配置");
    const syncIndex = html.indexOf("同步信息");
    const dataIndex = html.indexOf("数据设置");

    expect(serverIndex).toBeGreaterThanOrEqual(0);
    expect(syncIndex).toBeGreaterThan(serverIndex);
    expect(dataIndex).toBeGreaterThan(syncIndex);
    expect(html).toContain("待同步: 2 条");
  });

  it("shows rejected and push conflict counts from the last cloud sync", () => {
    useSyncContextMock.mockReturnValue({
      ...defaultSyncState(),
      lastResult: { checked: true, identical: false, backupCreated: true, pushed: 1, rejected: 2, pushConflicts: 1, pushIssues: [], pulled: 3, conflicts: [] },
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("云端拒绝 2 条");
    expect(html).toContain("云端冲突 1 条");
  });

  it("shows failed push outcome details instead of only aggregate counts", () => {
    useSyncContextMock.mockReturnValue({
      ...defaultSyncState(),
      lastResult: {
        checked: true,
        identical: false,
        backupCreated: true,
        pushed: 1,
        rejected: 0,
        pushConflicts: 1,
        pulled: 0,
        conflicts: [],
        pushIssues: [
          {
            tableName: "time_entries",
            recordId: "entry-conflict",
            action: "create",
            status: "conflict",
            reasonCode: "overlap",
            message: "entry overlaps existing entry server-entry",
            incomingTimestamp: "2026-05-08T09:30:00",
          },
        ],
      },
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("time_entries/entry-conflict");
    expect(html).toContain("overlap");
    expect(html).toContain("entry overlaps existing entry server-entry");
  });

  it("shows no-op sync text when local and cloud data already match", () => {
    useSyncContextMock.mockReturnValue({
      ...defaultSyncState(),
      lastResult: { checked: true, identical: true, backupCreated: false, pushed: 0, rejected: 0, pushConflicts: 0, pushIssues: [], pulled: 0, conflicts: [] },
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("本地与云端数据一致，无需同步。");
  });
});

describe("getServerConnectionState", () => {
  it("uses a green dot when a configured server returns version info", () => {
    expect(getServerConnectionState("https://example.com", {
      current: "abc1234",
      latest: "def5678",
      hasUpdate: true,
      checkedAt: "2026-05-08T08:00:00.000Z",
    }, true)).toEqual({
      color: "green",
      subtitle: "服务器已连接",
    });
  });
});
