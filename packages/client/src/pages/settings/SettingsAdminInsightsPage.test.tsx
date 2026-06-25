// @vitest-environment jsdom
import type {
  AdminAnalyticsResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminRequestLogsResponse,
  AdminSummaryResponse,
  AdminSyncResponse,
} from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsAdminInsightsPage from "./SettingsAdminInsightsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchAdminSummary = vi.hoisted(() => vi.fn());
const fetchAdminEntries = vi.hoisted(() => vi.fn());
const fetchAdminCategories = vi.hoisted(() => vi.fn());
const fetchAdminSync = vi.hoisted(() => vi.fn());
const fetchAdminBackups = vi.hoisted(() => vi.fn());
const fetchAdminHealthChecks = vi.hoisted(() => vi.fn());
const fetchAdminAnalytics = vi.hoisted(() => vi.fn());
const fetchAdminRequestLogs = vi.hoisted(() => vi.fn());

vi.mock("../../lib/adminApi.ts", () => ({
  fetchAdminSummary,
  fetchAdminEntries,
  fetchAdminCategories,
  fetchAdminSync,
  fetchAdminBackups,
  fetchAdminHealthChecks,
  fetchAdminAnalytics,
  fetchAdminRequestLogs,
}));

const summaryResponse: AdminSummaryResponse = {
  generatedAt: "2026-05-19T00:00:00.000Z",
  counts: {
    categories: 3,
    activeCategories: 2,
    archivedCategories: 1,
    timeEntries: 12,
    syncLogs: 4,
    tombstones: 0,
    serverBackups: 2,
  },
  latest: {
    entryUpdatedAt: "2026-05-19T08:00:00.000Z",
    syncLogTimestamp: "2026-05-19T09:00:00.000Z",
    backupCreatedAt: "2026-05-19T10:00:00.000Z",
  },
};

const entriesResponse: AdminEntriesResponse = {
  entries: [
    {
      id: "entry-1",
      categoryId: "cat-1",
      categoryName: "写作",
      parentCategoryName: null,
      startTime: "2026-05-19T08:00:00.000Z",
      endTime: "2026-05-19T09:00:00.000Z",
      durationMinutes: 60,
      note: null,
      createdAt: "2026-05-19T08:00:00.000Z",
      updatedAt: "2026-05-19T09:00:00.000Z",
      anomaly: null,
    },
  ],
  limit: 10,
  offset: 0,
  total: 1,
};

const categoriesResponse: AdminCategoriesResponse = {
  categories: [
    {
      id: "cat-1",
      name: "写作",
      parentId: null,
      parentName: null,
      color: "#3b82f6",
      icon: null,
      sortOrder: 1,
      isArchived: false,
      entryCount: 5,
      totalMinutes: 300,
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    },
  ],
};

const syncResponse: AdminSyncResponse = {
  logs: [
    {
      id: 1,
      timestamp: "2026-05-19T09:00:00.000Z",
      device: "browser",
      action: "push",
      detail: "ok",
      recordCount: 2,
    },
  ],
  recentRejectedCount: 0,
  recentConflictCount: 1,
  recentIssues: [],
};

const backupsResponse: AdminBackupsResponse = {
  backups: [
    {
      id: "backup-1",
      fileName: "timedata-backup.sqlite",
      operation: "sync_push",
      sizeBytes: 2048,
      createdAt: "2026-05-19T10:00:00.000Z",
      protected: true,
      reason: "conflict",
      retention: "protected",
      relatedSyncLogId: 1,
    },
  ],
};

const healthChecksResponse: AdminHealthChecksResponse = {
  generatedAt: "2026-05-19T11:00:00.000Z",
  checks: [
    {
      code: "missing_category",
      severity: "warning",
      count: 1,
      sampleIds: ["entry-missing-category"],
    },
  ],
};

const analyticsResponse: AdminAnalyticsResponse = {
  range: {
    from: null,
    to: null,
    groupBy: "day",
  },
  byTime: [
    {
      bucket: "2026-05-19",
      totalMinutes: 180,
      entryCount: 3,
    },
  ],
  byCategory: [
    {
      categoryId: "cat-1",
      categoryName: "写作",
      parentCategoryName: null,
      totalMinutes: 180,
      entryCount: 3,
      color: "#3b82f6",
    },
  ],
};

const requestLogsResponse: AdminRequestLogsResponse = {
  limit: 100,
  logs: [
    {
      id: 1,
      timestamp: "2026-05-19T12:00:00.000Z",
      method: "POST",
      path: "/api/agent/tasks/task-1/status",
      status: 401,
      outcome: "auth_failed",
      tokenTier: "invalid",
      ip: "127.0.0.1",
      userAgent: "Vitest",
      clientHint: "agent",
      deviceLabel: "agent",
      durationMs: 12,
    },
  ],
};

function mockSuccessfulAdminInsights() {
  fetchAdminSummary.mockResolvedValue(summaryResponse);
  fetchAdminEntries.mockResolvedValue(entriesResponse);
  fetchAdminCategories.mockResolvedValue(categoriesResponse);
  fetchAdminSync.mockResolvedValue(syncResponse);
  fetchAdminBackups.mockResolvedValue(backupsResponse);
  fetchAdminHealthChecks.mockResolvedValue(healthChecksResponse);
  fetchAdminAnalytics.mockResolvedValue(analyticsResponse);
  fetchAdminRequestLogs.mockResolvedValue(requestLogsResponse);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("SettingsAdminInsightsPage", () => {
  it("renders the read-only admin insight shell", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(html).toContain("服务端数据洞察");
    expect(html).toContain("只读查看服务器 SQLite 数据");
    expect(html).toContain("这里不会修改服务器数据");
    expect(html).toContain("正在加载服务端数据");
  });

  it("renders successful admin insight sections when one endpoint fails", async () => {
    mockSuccessfulAdminInsights();
    fetchAdminEntries.mockRejectedValue(new Error("最近记录接口 404"));
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    });

    expect(host.textContent).toContain("部分服务端洞察加载失败：最近记录接口 404");
    expect(host.textContent).toContain("时间记录");
    expect(host.textContent).toContain("数据健康检查");
    expect(host.textContent).toContain("分析概览");
    expect(host.textContent).toContain("分类汇总");
    expect(host.textContent).toContain("同步诊断");
    expect(host.textContent).toContain("服务端备份");
    expect(host.textContent).toContain("请求审计");
    expect(host.textContent).toContain("权限矩阵");
    expect(host.textContent).toContain("entry-missing-category");
    expect(host.textContent).toContain("timedata-backup.sqlite");
    expect(host.textContent).toContain("/api/agent/tasks/task-1/status");
    expect(host.textContent).toContain("auth_failed");

    await act(async () => {
      root.unmount();
    });
  });

  it("filters request audit logs independently", async () => {
    mockSuccessfulAdminInsights();
    fetchAdminRequestLogs.mockResolvedValue({ limit: 100, logs: [] });
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    });

    const statusSelect = host.querySelector("select[aria-label='请求状态']");
    const outcomeSelect = host.querySelector("select[aria-label='请求结果']");
    const tierSelect = host.querySelector("select[aria-label='令牌层级']");
    const clientSelect = host.querySelector("select[aria-label='客户端提示']");
    expect(statusSelect).not.toBeNull();
    expect(outcomeSelect).not.toBeNull();
    expect(tierSelect).not.toBeNull();
    expect(clientSelect).not.toBeNull();

    await act(async () => {
      (statusSelect as HTMLSelectElement).value = "401";
      statusSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      (outcomeSelect as HTMLSelectElement).value = "auth_failed";
      outcomeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      (tierSelect as HTMLSelectElement).value = "invalid";
      tierSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      (clientSelect as HTMLSelectElement).value = "agent";
      clientSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(fetchAdminRequestLogs).toHaveBeenLastCalledWith({
      limit: 100,
      status: 401,
      outcome: "auth_failed",
      tokenTier: "invalid",
      clientHint: "agent",
    });
    expect(host.textContent).toContain("暂无请求审计记录。");

    await act(async () => {
      root.unmount();
    });
  });
});
