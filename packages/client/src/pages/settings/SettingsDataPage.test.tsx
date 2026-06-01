import { act, createElement } from "react";
// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(html).toContain("跨天记录合并展示");
    expect(html).toContain("备份与数据");
    expect(html).toContain("速记数据");
    expect(html).toContain("导出速记 JSON");
    expect(html).toContain("导出速记 Markdown");
    expect(html).toContain("导入速记 JSON");
    expect(html).toContain("删除日期范围速记");
    expect(html).toContain("高级 · 数据恢复");
    expect(html).toContain("强制替换");
    expect(html).toContain("导出完整备份");
    expect(html).toContain("从完整备份恢复");
    expect(html).toContain("查看本地备份记录");
    expect(html).toContain("同步健康诊断");
    expect(html).toContain("将本地数据覆盖到云端");
    expect(html).toContain("数据重置");
    expect(html).not.toContain("本地未来记录修复");
    expect(html).not.toContain("检查本地未来记录");
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
    syncContextMock.value.conflicts = [
      {
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
      },
    ];

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).toContain("服务器上这条记录已被删除");
    expect(html).toContain("保留本地（重新创建到服务器）");
    expect(html).toContain("接受删除（丢弃本地修改）");
  });

  it("opens the recovery details when sync diagnostics are needed", async () => {
    syncContextMock.value.needsSyncDiagnostics = true;
    syncContextMock.value.syncFailureCount = 3;
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsDataPage)));
    });

    const details = host.querySelector("details");
    expect(details?.open).toBe(true);
    expect(host.textContent).toContain("普通同步已连续失败 3 次");

    await act(async () => {
      root.unmount();
    });
  });
});
