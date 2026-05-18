import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdminAnalytics,
  fetchAdminBackups,
  fetchAdminCategories,
  fetchAdminEntries,
  fetchAdminHealthChecks,
  fetchAdminSummary,
  fetchAdminSync,
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
});
