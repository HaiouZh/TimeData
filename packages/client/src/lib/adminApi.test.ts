import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdminAnalytics,
  fetchAdminBackups,
  fetchAdminCategories,
  fetchAdminEntries,
  fetchAdminHealthChecks,
  fetchAdminRequestLogs,
  fetchAdminSummary,
  fetchAdminSync,
  deleteAdminBackup,
  fetchBackupConfig,
  triggerDailyBackup,
  updateBackupConfig,
} from "./adminApi.js";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("./api.ts", () => ({ apiFetch }));

afterEach(() => {
  apiFetch.mockReset();
});

describe("adminApi", () => {
  it("fetches each fixed admin endpoint", async () => {
    apiFetch.mockResolvedValue({});

    await fetchAdminSummary();
    await fetchAdminCategories();
    await fetchAdminSync();
    await fetchAdminBackups();
    await fetchAdminHealthChecks();

    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/admin/summary",
      "/api/admin/categories",
      "/api/admin/sync",
      "/api/admin/backups",
      "/api/admin/health-checks",
    ]);
  });

  it("serializes entries filters", async () => {
    apiFetch.mockResolvedValue({});

    await fetchAdminEntries({
      from: "2026-05-08",
      to: "2026-05-09",
      anomaly: "missing_category",
      limit: 25,
      offset: 50,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/admin/entries?from=2026-05-08&to=2026-05-09&anomaly=missing_category&limit=25&offset=50",
    );
  });

  it("omits empty analytics filters", async () => {
    apiFetch.mockResolvedValue({});

    await fetchAdminAnalytics({ from: "2026-05-08", groupBy: "month" });

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/analytics?from=2026-05-08&groupBy=month");
  });

  it("serializes request audit filters", async () => {
    apiFetch.mockResolvedValue({});

    await fetchAdminRequestLogs({
      limit: 25,
      status: 401,
      outcome: "auth_failed",
      tokenTier: "invalid",
      clientHint: "agent",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/admin/request-logs?limit=25&status=401&outcome=auth_failed&tokenTier=invalid&clientHint=agent",
    );
  });

  it("fetches backup config", async () => {
    apiFetch.mockResolvedValue({ config: { dailyBackup: { enabled: true, timeOfDay: "04:00" }, retentionDays: 7 } });

    await fetchBackupConfig();

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/backup-config");
  });

  it("updateBackupConfig PUTs config", async () => {
    apiFetch.mockResolvedValue({
      config: { dailyBackup: { enabled: true, timeOfDay: "04:00" }, retentionDays: 7 },
    });
    const cfg = { dailyBackup: { enabled: true, timeOfDay: "04:00" }, retentionDays: 7 };

    await updateBackupConfig(cfg);

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/backup-config", { method: "PUT", body: JSON.stringify(cfg) });
  });

  it("deleteAdminBackup DELETEs by id", async () => {
    apiFetch.mockResolvedValue({ deleted: "b1" });

    await deleteAdminBackup("b1");

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/backups/b1", { method: "DELETE" });
  });

  it("triggerDailyBackup POSTs run-daily", async () => {
    apiFetch.mockResolvedValue({ created: false, backupId: null, reason: "no_change" });

    await triggerDailyBackup();

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/backups/run-daily", { method: "POST" });
  });
});
