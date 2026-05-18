// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findFutureEndedEntries } from "../../hooks/useEntries.js";
import SettingsDataPage from "./SettingsDataPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const syncContextMock = vi.hoisted(() => ({
  value: {
    syncing: false,
    error: null,
    forceReplace: vi.fn(),
    refreshSyncStatus: vi.fn(),
    healthReport: null,
    healthLoading: false,
    forcePushPreparation: null,
    syncFailureCount: 0,
    needsSyncDiagnostics: false,
    runDiagnostics: vi.fn(),
    prepareForcePushToServer: vi.fn(),
    forcePushToServer: vi.fn(),
    apiUrl: "https://example.com",
    updateApiUrl: vi.fn(),
    cloudSyncEnabled: true,
    setCloudSyncEnabledInContext: vi.fn(),
    conflicts: [],
    handleConflictResolution: vi.fn(),
  },
}));

vi.mock("../../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => syncContextMock.value,
}));

vi.mock("../../hooks/useEntries.js", () => ({
  findFutureEndedEntries: vi.fn(async () => []),
  deleteFutureEndedEntries: vi.fn(async () => ({ deletedCount: 0, deletedEntryIds: [] })),
}));

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

describe("SettingsDataPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    syncContextMock.value = {
      syncing: false,
      error: null,
      forceReplace: vi.fn(),
      refreshSyncStatus: vi.fn(),
      healthReport: null,
      healthLoading: false,
      forcePushPreparation: null,
      syncFailureCount: 0,
      needsSyncDiagnostics: false,
      runDiagnostics: vi.fn(),
      prepareForcePushToServer: vi.fn(),
      forcePushToServer: vi.fn(),
      apiUrl: "https://example.com",
      updateApiUrl: vi.fn(),
      cloudSyncEnabled: true,
      setCloudSyncEnabledInContext: vi.fn(),
      conflicts: [],
      handleConflictResolution: vi.fn(),
    };
  });

  it("renders the target data setting sections", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).toContain("数据设置");
    expect(html).toContain("是否开启云同步");
    expect(html).toContain("强制替换");
    expect(html).toContain("数据导出");
    expect(html).toContain("数据恢复");
    expect(html).toContain("同步健康诊断");
    expect(html).toContain("本地未来记录修复");
    expect(html).toContain("检查本地未来记录");
    expect(html).toContain("将本地数据覆盖到云端");
    expect(html).toContain("数据重置");
  });

  it("shows the restore status from navigation state", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: "/settings/data", state: { dataStatus: "已恢复自动备份" } }] },
        createElement(SettingsDataPage),
      ),
    );

    expect(html).toContain("已恢复自动备份");
  });

  it("shows remote delete conflict choices", () => {
    syncContextMock.value.conflicts = [{
      tableName: "time_entries",
      recordId: "entry-delete-conflict",
      local: {
        id: "entry-delete-conflict",
        categoryId: "cat-local",
        startTime: "2026-05-07T09:00:00.000Z",
        endTime: "2026-05-07T10:00:00.000Z",
        note: "local pending",
        createdAt: "2026-05-07T08:00:00.000Z",
        updatedAt: "2026-05-07T12:00:00.000Z",
      },
      remote: null,
      remoteAction: "delete",
    }];

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).toContain("服务器上这条记录已被删除");
    expect(html).toContain("保留本地（重新创建到服务器）");
    expect(html).toContain("接受删除（丢弃本地修改）");
  });

  it("shows future repair check feedback next to the repair action", async () => {
    vi.mocked(findFutureEndedEntries).mockResolvedValueOnce([]);
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsDataPage)));
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "检查本地未来记录");
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("未发现结束时间晚于现在的本地记录。");

    await act(async () => {
      root.unmount();
    });
  });
});
