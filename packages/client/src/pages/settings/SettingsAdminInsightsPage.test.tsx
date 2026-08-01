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
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";
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

const fetchTotpStatus = vi.hoisted(() => vi.fn());
const setupTotp = vi.hoisted(() => vi.fn());
const confirmTotp = vi.hoisted(() => vi.fn());
const disableTotp = vi.hoisted(() => vi.fn());

const fetchUnacknowledgedNewIps = vi.hoisted(() => vi.fn());
const acknowledgeNewIp = vi.hoisted(() => vi.fn());

vi.mock("../../lib/adminNewIps.ts", () => ({
  fetchUnacknowledgedNewIps,
  acknowledgeNewIp,
}));

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
  fetchTotpStatus,
  setupTotp,
  confirmTotp,
  disableTotp,
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
      isNewIp: false,
      country: null,
      city: null,
      asnOrg: null,
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
  fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [] });
  acknowledgeNewIp.mockResolvedValue({ ok: true });
  fetchTotpStatus.mockResolvedValue({ enrolled: false });
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

  it("renders new-source alert card with geo label, highlights rows, and acknowledges by scopeKey", async () => {
    mockSuccessfulAdminInsights();
    fetchUnacknowledgedNewIps.mockResolvedValue({
      geoip: { city: true, asn: true },
      newIps: [
        {
          tokenTier: "master",
          scopeKey: "asn:9808|geo:1796236",
          country: "中国",
          city: "上海",
          asnOrg: "China Mobile",
          lastIp: "203.0.113.9",
          firstSeen: "2026-07-28T08:00:00.000Z",
          lastSeen: "2026-07-28T09:00:00.000Z",
        },
      ],
    });
    // 日志行故意用另一组归属地:否则提醒卡整段不渲染,页面级 textContent 断言也会
    // 被日志行满足(曾是假闸——把卡片主行删掉测试照样绿)。
    fetchAdminRequestLogs.mockResolvedValue({
      limit: 100,
      logs: [
        {
          ...requestLogsResponse.logs[0], id: 1, ip: "198.51.100.7", isNewIp: true,
          country: "美国", city: "圣何塞", asnOrg: "DigitalOcean",
        },
        {
          ...requestLogsResponse.logs[0], id: 2, ip: "127.0.0.1", isNewIp: false,
          country: null, city: null, asnOrg: null,
        },
      ],
    });
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    // 提醒卡内部断言:主行是归属地 + 运营商,IP 降为副行。范围限定在卡片子树里,
    // 不用页面级 textContent——否则日志行能冒充卡片。
    const card = host.querySelector('[data-testid="new-ip-alert-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("检测到陌生来源");
    expect(card?.textContent).toContain("中国 · 上海");
    expect(card?.textContent).toContain("China Mobile");
    expect(card?.textContent).toContain("最近 IP 203.0.113.9");

    // 日志行侧:有归属地的显示出来,查不到的显示「位置未知」
    expect(host.textContent).toContain("美国 · 圣何塞");
    expect(host.textContent).toContain("DigitalOcean");
    expect(host.textContent).toContain("位置未知");

    // 两个库都就绪时不显示未就绪提示
    expect(host.querySelector('[data-testid="geoip-readiness-notice"]')).toBeNull();

    const badges = Array.from(host.querySelectorAll("span")).filter(
      (item) => item.textContent === "新来源",
    );
    expect(badges.length).toBeGreaterThan(0);

    // 点「知道了」→ 按 scopeKey 确认并从列表移除
    const ackButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("知道了"),
    );
    expect(ackButton).not.toBeNull();
    await act(async () => {
      ackButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(acknowledgeNewIp).toHaveBeenCalledWith("master", "asn:9808|geo:1796236");
    expect(host.querySelector('[data-testid="new-ip-alert-card"]')).toBeNull();

    await unmount(root);
  });

  it("归属地库未就绪时显示提示,缺哪个库说哪个", async () => {
    mockSuccessfulAdminInsights();
    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: false, asn: false } });
    const bothMissing = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    const bothNotice = bothMissing.host.querySelector('[data-testid="geoip-readiness-notice"]');
    expect(bothNotice?.textContent).toContain("两个 GeoLite2 库都没读到");
    expect(bothNotice?.textContent).toContain("data/geoip/");
    await unmount(bothMissing.root);

    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: true, asn: false } });
    const asnMissing = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    expect(asnMissing.host.querySelector('[data-testid="geoip-readiness-notice"]')?.textContent)
      .toContain("缺 GeoLite2-ASN");
    await unmount(asnMissing.root);

    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: false, asn: true } });
    const cityMissing = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    expect(cityMissing.host.querySelector('[data-testid="geoip-readiness-notice"]')?.textContent)
      .toContain("缺 GeoLite2-City");
    await unmount(cityMissing.root);
  });

  it("中国段表缺失时单独提示,并可与 GeoLite2 缺失并列显示", async () => {
    mockSuccessfulAdminInsights();
    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: true, asn: true, chinaTable: false } });
    const cnMissing = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    const cnNotice = cnMissing.host.querySelector('[data-testid="geoip-readiness-notice"]');
    expect(cnNotice?.textContent).toContain("中国归属地表未就绪");
    expect(cnNotice?.textContent).not.toContain("缺 GeoLite2");
    await unmount(cnMissing.root);

    // 两种缺失正交,提示条要能同时说两件事
    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: false, asn: true, chinaTable: false } });
    const both = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    const bothText = both.host.querySelector('[data-testid="geoip-readiness-notice"]')?.textContent ?? "";
    expect(bothText).toContain("缺 GeoLite2-City");
    expect(bothText).toContain("中国归属地表未就绪");
    await unmount(both.root);
  });

  // 老服务端不返回 chinaTable,升级前不该刷出假告警
  it("chinaTable 字段缺失时按就绪处理,不显示提示条", async () => {
    mockSuccessfulAdminInsights();
    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: true, asn: true } });
    const legacy = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    expect(legacy.host.querySelector('[data-testid="geoip-readiness-notice"]')).toBeNull();
    await unmount(legacy.root);
  });

  it("三者都就绪时不显示提示条", async () => {
    mockSuccessfulAdminInsights();
    fetchUnacknowledgedNewIps.mockResolvedValue({ newIps: [], geoip: { city: true, asn: true, chinaTable: true } });
    const ready = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));
    expect(ready.host.querySelector('[data-testid="geoip-readiness-notice"]')).toBeNull();
    await unmount(ready.root);
  });

  it("hides new-IP alert card when nothing is unacknowledged", async () => {
    mockSuccessfulAdminInsights();
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(host.textContent).not.toContain("检测到陌生来源");

    await unmount(root);
  });

  it("用户取消 TOTP 弹码：备份保存/删除都不显示错误文案", async () => {
    mockSuccessfulAdminInsights();
    // 弹窗宿主未挂载 → callWithTotp 的 defaultPrompt 直接返回 null，等价于用户点「取消」
    const totpRequired = new ApiError(401, "Unauthorized", JSON.stringify({ error: "totp_required" }), {
      error: "totp_required",
    });
    updateBackupConfig.mockRejectedValue(totpRequired);
    deleteAdminBackup.mockRejectedValue(totpRequired);
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存备份设置"),
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("备份设置保存失败");
    expect(host.textContent).not.toContain("API error");

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
    expect(deleteAdminBackup).toHaveBeenCalled();
    expect(host.textContent).not.toContain("备份删除失败");
    expect(host.textContent).not.toContain("API error");

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
    // callWithTotp 先裸调：第二参是空的 totpHeaders
    expect(updateBackupConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        retentionDays: 14,
      }),
      {},
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
    expect(deleteAdminBackup).toHaveBeenCalledWith("backup-1", {});
    expect(fetchAdminBackups).toHaveBeenCalledTimes(3);

    await unmount(root);
  });
});
