// @vitest-environment jsdom
import type {
  AdminAnalyticsResponse,
  AdminBackupConfigResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminRequestLogsResponse,
  AdminSummaryResponse,
  AdminSyncResponse,
} from "@timedata/shared";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import SettingsAdminInsightsPage from "./SettingsAdminInsightsPage.js";

const fetchAdminSummary = vi.hoisted(() => vi.fn());
const fetchAdminEntries = vi.hoisted(() => vi.fn());
const fetchAdminCategories = vi.hoisted(() => vi.fn());
const fetchAdminSync = vi.hoisted(() => vi.fn());
const fetchAdminBackups = vi.hoisted(() => vi.fn());
const fetchBackupConfig = vi.hoisted(() => vi.fn());
const updateBackupConfig = vi.hoisted(() => vi.fn());
const deleteAdminBackup = vi.hoisted(() => vi.fn());
const triggerDailyBackup = vi.hoisted(() => vi.fn());
const fetchAdminHealthChecks = vi.hoisted(() => vi.fn());
const fetchAdminAnalytics = vi.hoisted(() => vi.fn());
const fetchAdminRequestLogs = vi.hoisted(() => vi.fn());

vi.mock("../../lib/adminApi.ts", () => ({
  fetchAdminSummary,
  fetchAdminEntries,
  fetchAdminCategories,
  fetchAdminSync,
  fetchAdminBackups,
  fetchBackupConfig,
  updateBackupConfig,
  deleteAdminBackup,
  triggerDailyBackup,
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

const backupConfigResponse: AdminBackupConfigResponse = {
  config: { dailyBackup: { enabled: true, timeOfDay: "04:00" }, retentionDays: 7 },
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

async function chooseFilterOption(host: ParentNode, ariaLabel: string, optionText: string) {
  const trigger = host.querySelector(`button[aria-label='${ariaLabel}']`);
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const option = Array.from(host.querySelectorAll('[role="dialog"] button')).find((item) =>
    item.textContent?.includes(optionText),
  );
  expect(option).not.toBeNull();
  await act(async () => {
    option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function mockSuccessfulAdminInsights() {
  fetchAdminSummary.mockResolvedValue(summaryResponse);
  fetchAdminEntries.mockResolvedValue(entriesResponse);
  fetchAdminCategories.mockResolvedValue(categoriesResponse);
  fetchAdminSync.mockResolvedValue(syncResponse);
  fetchAdminBackups.mockResolvedValue(backupsResponse);
  fetchBackupConfig.mockResolvedValue(backupConfigResponse);
  updateBackupConfig.mockResolvedValue(backupConfigResponse);
  deleteAdminBackup.mockResolvedValue({ deleted: "backup-1" });
  triggerDailyBackup.mockResolvedValue({ created: false, backupId: null, reason: "no_change" });
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
    expect(html).toContain("诊断数据只读查看");
    expect(html).toContain("仅备份管理会修改服务器备份");
    expect(html).toContain("正在加载服务端数据");
  });

  it("uses settings design tokens for the admin shell", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(html).not.toMatch(
      /(?:bg|text|border|divide|placeholder|ring-offset)-slate-|rounded-xl|bg-blue-|text-blue-|border-blue-|red-950|amber-900/,
    );
  });

  it("renders successful admin insight sections when one endpoint fails", async () => {
    mockSuccessfulAdminInsights();
    fetchAdminEntries.mockRejectedValue(new Error("最近记录接口 404"));
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(host.textContent).toContain("部分服务端洞察加载失败：最近记录接口 404");
    expect(host.textContent).toContain("时间记录");
    expect(host.textContent).toContain("数据健康检查");
    expect(host.textContent).toContain("分析概览");
    expect(host.textContent).toContain("分类汇总");
    expect(host.textContent).toContain("同步诊断");
    expect(host.textContent).toContain("服务端备份");
    expect(host.textContent).toContain("请求审计");
    expect(host.textContent).toContain("权限矩阵");
    expect(host.textContent).toContain("备份设置");
    expect(host.textContent).toContain("保留天数");
    expect(host.textContent).toContain("entry-missing-category");
    expect(host.textContent).toContain("timedata-backup.sqlite");
    expect(host.textContent).toContain("/api/agent/tasks/task-1/status");
    expect(host.textContent).toContain("auth_failed");

    await unmount(root);
  });

  it("filters request audit logs independently", async () => {
    mockSuccessfulAdminInsights();
    fetchAdminRequestLogs.mockResolvedValue({ limit: 100, logs: [] });
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(host.querySelector("select")).toBeNull();

    await chooseFilterOption(host, "请求状态", "401");
    await chooseFilterOption(host, "请求结果", "认证失败");
    await chooseFilterOption(host, "令牌层级", "无效");
    await chooseFilterOption(host, "客户端提示", "Agent");

    expect(fetchAdminRequestLogs).toHaveBeenLastCalledWith({
      limit: 100,
      status: 401,
      outcome: "auth_failed",
      tokenTier: "invalid",
      clientHint: "agent",
    });
    expect(host.textContent).toContain("暂无请求审计记录。");

    await unmount(root);
  });

  it("updates backup config, triggers daily backup, and deletes backups", async () => {
    mockSuccessfulAdminInsights();
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    const retentionInput = host.querySelector("input[aria-label='备份保留天数']");
    expect(retentionInput).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(retentionInput, "14");
      retentionInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存备份设置"),
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(updateBackupConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        retentionDays: 14,
      }),
    );

    const runButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("立即触发日备"),
    );
    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(triggerDailyBackup).toHaveBeenCalled();

    const deleteButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "删除");
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirmButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "删除备份",
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deleteAdminBackup).toHaveBeenCalledWith("backup-1");
    expect(fetchAdminBackups).toHaveBeenCalledTimes(3);

    await unmount(root);
  });
});
