// @vitest-environment jsdom

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage, { getServerConnectionState } from "./SettingsPage.js";
import { click, renderDom, unmount } from "../test/domHarness.tsx";

const useSyncContextMock = vi.hoisted(() => vi.fn());
const forceRefreshMock = vi.hoisted(() => vi.fn());
const fetchServerVersionMock = vi.hoisted(() => vi.fn());
const triggerServerUpdateMock = vi.hoisted(() => vi.fn());
const fetchUpdateStatusMock = vi.hoisted(() => vi.fn());
const pollServerUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: useSyncContextMock,
}));

vi.mock("../appUpdate.tsx", () => ({
  useAppUpdate: () => ({
    needRefresh: false,
    updateApp: vi.fn(),
    dismissUpdate: vi.fn(),
    currentBuildId: "build-xyz",
    forceRefresh: forceRefreshMock,
  }),
}));

function defaultSyncState() {
  return {
    syncing: false,
    lastSynced: "2026-05-08T08:00:00.000Z",
    unsyncedCount: 2,
    error: null,
    conflicts: [],
    lastResult: {
      checked: true,
      identical: false,
      pushed: 1,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 3,
      conflicts: [],
    },
    apiUrl: localStorage.getItem("timedata_api_url") || "",
    updateApiUrl: vi.fn(),
    cloudSyncEnabled: true,
    connection: "connected",
    sync: vi.fn(),
    forceReplace: vi.fn(),
    handleConflictResolution: vi.fn(),
    refreshSyncStatus: vi.fn(),
  };
}

vi.mock("../lib/serverVersion.ts", () => ({
  fetchServerVersion: fetchServerVersionMock,
  triggerServerUpdate: triggerServerUpdateMock,
  fetchUpdateStatus: fetchUpdateStatusMock,
  pollServerUpdate: pollServerUpdateMock,
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

function serverVersion(current: string, latest: string, hasUpdate: boolean) {
  return {
    ok: true,
    version: {
      current,
      latest,
      hasUpdate,
      checkedAt: "2026-05-08T08:00:00.000Z",
      checkOk: true,
    },
  };
}

async function waitForText(root: ParentNode, text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (root.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text));
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    useSyncContextMock.mockReturnValue(defaultSyncState());
    fetchServerVersionMock.mockReset();
    triggerServerUpdateMock.mockReset();
    fetchUpdateStatusMock.mockReset();
    pollServerUpdateMock.mockReset();
    fetchServerVersionMock.mockResolvedValue(serverVersion("abc1234", "def5678", true));
    triggerServerUpdateMock.mockResolvedValue({ ok: true, updateId: "update-default" });
    fetchUpdateStatusMock.mockResolvedValue(null);
    pollServerUpdateMock.mockResolvedValue({ kind: "succeeded", version: "def5678" });
  });

  it("reflects apiUrl updates from sync context", () => {
    localStorage.clear();
    useSyncContextMock.mockReturnValue({
      ...defaultSyncState(),
      apiUrl: "https://new.example",
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("服务器已连接");
    expect(html).not.toContain("未配置服务器");
  });

  it("renders the target horizontal settings entries", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("服务器配置");
    expect(html).toContain('href="/settings/server"');
    expect(html).toContain("数据设置");
    expect(html).toContain("数据洞察");
    expect(html).toContain("统计页面布局");
    expect(html).toContain("导航");
    expect(html).toContain("配置移动底栏与桌面侧栏");
    expect(html).toContain('href="/settings/insights"');
    expect(html).toContain('href="/settings/stats-layout"');
    expect(html).toContain('href="/settings/nav"');
    expect(html).toContain('href="/settings/data"');
    expect(html).toContain("服务端数据洞察");
    expect(html).toContain('href="/settings/admin-insights"');
    expect(html).toContain("APK 更新");
    expect(html).toContain("服务端更新");
    expect(html).toContain("刷新到最新前端");
  });

  it("renders settings home entries without changing navigation targets", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("设置");
    expect(html).toContain('href="/settings/server"');
    expect(html).toContain('href="/settings/categories"');
    expect(html).toContain('href="/settings/health-range"');
    expect(html).toContain('href="/settings/nav"');
    expect(html).toContain('href="/settings/tracks"');
    expect(html).toContain('href="/settings/data"');
    expect(html).toContain('href="/settings/garmin"');
    expect(html).toContain('href="/settings/admin-insights"');
    expect(html).toContain("水位线与翻牌");
    expect(html).toContain('href="/settings/todo-gravity"');
  });

  it("organizes settings into five user-facing groups", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    for (const label of ["连接与同步", "记录偏好", "统计与健康", "导航与界面", "高级与更新"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('href="/settings/insights"');
    expect(html).toContain("记录偏好");
    expect(html).not.toContain(">杂项<");
  });

  it("shows the manual frontend refresh row with the current build id", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("刷新到最新前端");
    expect(html).toContain("build-xyz");
  });

  it("force-rechecks version, triggers update, and drives it to completion", async () => {
    fetchServerVersionMock
      .mockResolvedValueOnce(serverVersion("e09fe9e", "e09fe9e", false))
      .mockResolvedValueOnce(serverVersion("e09fe9e", "3061657", true));
    triggerServerUpdateMock.mockResolvedValue({ ok: true, updateId: "update-1" });
    pollServerUpdateMock.mockResolvedValue({ kind: "succeeded", version: "3061657" });

    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsPage)));
    try {
      await waitForText(host, "当前 e09fe9e / 最新 e09fe9e");

      await click(buttonByText(host, "服务端更新"));
      await waitForText(host, "确认更新到 3061657");
      await click(buttonByText(host, "确认"));

      await waitForText(host, "已更新到 3061657 ✅");
      expect(fetchServerVersionMock).toHaveBeenCalledTimes(2);
      expect(triggerServerUpdateMock).toHaveBeenCalledTimes(1);
      expect(pollServerUpdateMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(root);
    }
  });

  it("reports failure when polling resolves failed", async () => {
    fetchServerVersionMock
      .mockResolvedValueOnce(serverVersion("e09fe9e", "e09fe9e", false))
      .mockResolvedValueOnce(serverVersion("e09fe9e", "3061657", true));
    triggerServerUpdateMock.mockResolvedValue({ ok: true, updateId: "update-2" });
    pollServerUpdateMock.mockResolvedValue({ kind: "failed", message: "watchtower update failed: 500" });

    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsPage)));
    try {
      await waitForText(host, "当前 e09fe9e / 最新 e09fe9e");
      await click(buttonByText(host, "服务端更新"));
      await waitForText(host, "确认更新到 3061657");
      await click(buttonByText(host, "确认"));
      await waitForText(host, "更新失败：watchtower update failed: 500");
    } finally {
      await unmount(root);
    }
  });

  it("does not claim up-to-date when the GitHub check failed", async () => {
    fetchServerVersionMock.mockResolvedValue({
      ok: true,
      version: { current: "e09fe9e", latest: "unknown", hasUpdate: false, checkedAt: "x", checkOk: false },
    });

    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsPage)));
    try {
      await click(buttonByText(host, "服务端更新"));
      await waitForText(host, "检查失败");
      expect(triggerServerUpdateMock).not.toHaveBeenCalled();
    } finally {
      await unmount(root);
    }
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
      lastResult: {
        checked: true,
        identical: false,
        pushed: 1,
        rejected: 2,
        pushConflicts: 1,
        pushIssues: [],
        pulled: 3,
        conflicts: [],
      },
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
      lastResult: {
        checked: true,
        identical: true,
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: 0,
        conflicts: [],
      },
    });

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));

    expect(html).toContain("本地与云端数据一致，无需同步。");
  });
});

describe("getServerConnectionState", () => {
  it("apiUrl 为空时灰点未配置", () => {
    expect(getServerConnectionState("", "disconnected")).toEqual({ color: "gray", subtitle: "未配置服务器" });
  });
  it("connected 时绿灯已连接", () => {
    expect(getServerConnectionState("https://example.com", "connected")).toEqual({
      color: "green",
      subtitle: "服务器已连接",
    });
  });
  it("disconnected 时红灯未连接", () => {
    expect(getServerConnectionState("https://example.com", "disconnected")).toEqual({
      color: "red",
      subtitle: "服务器未连接",
    });
  });
  it("connecting 时黄灯正在连接", () => {
    expect(getServerConnectionState("https://example.com", "connecting")).toEqual({
      color: "yellow",
      subtitle: "正在连接服务器",
    });
  });
});
