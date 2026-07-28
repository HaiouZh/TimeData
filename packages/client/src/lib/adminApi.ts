import type {
  AdminAnalyticsResponse,
  AdminBackupConfigResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminRequestLogClientHint,
  AdminRequestLogOutcome,
  AdminRequestLogsResponse,
  AdminRequestLogTokenTier,
  AdminRunDailyResponse,
  AdminSummaryResponse,
  AdminSyncResponse,
  BackupConfig,
} from "@timedata/shared";
import { apiFetch } from "./api.ts";

export type AdminEntryAnomalyFilter = "invalid_time_range" | "missing_category" | "archived_category";
export type AdminAnalyticsGroupBy = "day" | "week" | "month";

export interface AdminEntriesQuery {
  from?: string;
  to?: string;
  anomaly?: AdminEntryAnomalyFilter;
  limit?: number;
  offset?: number;
}

export interface AdminAnalyticsQuery {
  from?: string;
  to?: string;
  groupBy?: AdminAnalyticsGroupBy;
}

export interface AdminRequestLogsQuery {
  limit?: number;
  status?: number;
  outcome?: AdminRequestLogOutcome;
  tokenTier?: AdminRequestLogTokenTier;
  clientHint?: AdminRequestLogClientHint;
}

function withQuery<T extends object>(path: string, query: T): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function fetchAdminSummary(): Promise<AdminSummaryResponse> {
  return apiFetch("/api/admin/summary");
}

export function fetchAdminEntries(query: AdminEntriesQuery = {}): Promise<AdminEntriesResponse> {
  return apiFetch(withQuery("/api/admin/entries", query));
}

export function fetchAdminCategories(): Promise<AdminCategoriesResponse> {
  return apiFetch("/api/admin/categories");
}

export function fetchAdminSync(): Promise<AdminSyncResponse> {
  return apiFetch("/api/admin/sync");
}

export function fetchAdminBackups(): Promise<AdminBackupsResponse> {
  return apiFetch("/api/admin/backups");
}

export function fetchBackupConfig(): Promise<AdminBackupConfigResponse> {
  return apiFetch("/api/admin/backup-config");
}

/** totpHeaders 由 callWithTotp 注入（危险操作被 requireTotp 锁定，需带 X-TOTP-Code 重试）。 */
export function updateBackupConfig(config: BackupConfig, totpHeaders?: Record<string, string>): Promise<AdminBackupConfigResponse> {
  return apiFetch("/api/admin/backup-config", {
    method: "PUT",
    body: JSON.stringify(config),
    ...(totpHeaders && Object.keys(totpHeaders).length > 0 ? { headers: totpHeaders } : {}),
  });
}

export function deleteAdminBackup(id: string, totpHeaders?: Record<string, string>): Promise<{ deleted: string }> {
  return apiFetch(`/api/admin/backups/${encodeURIComponent(id)}`, {
    method: "DELETE",
    ...(totpHeaders && Object.keys(totpHeaders).length > 0 ? { headers: totpHeaders } : {}),
  });
}

export function triggerDailyBackup(): Promise<AdminRunDailyResponse> {
  return apiFetch("/api/admin/backups/run-daily", { method: "POST" });
}

export function fetchAdminHealthChecks(): Promise<AdminHealthChecksResponse> {
  return apiFetch("/api/admin/health-checks");
}

export function fetchAdminAnalytics(query: AdminAnalyticsQuery = {}): Promise<AdminAnalyticsResponse> {
  return apiFetch(withQuery("/api/admin/analytics", query));
}

export function fetchAdminRequestLogs(query: AdminRequestLogsQuery = {}): Promise<AdminRequestLogsResponse> {
  return apiFetch(withQuery("/api/admin/request-logs", query));
}

export interface TotpStatusResponse {
  enrolled: boolean;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

export function fetchTotpStatus(): Promise<TotpStatusResponse> {
  return apiFetch("/api/admin/totp");
}

export function setupTotp(): Promise<TotpSetupResponse> {
  return apiFetch("/api/admin/totp/setup", { method: "POST" });
}

export function confirmTotp(code: string): Promise<TotpStatusResponse> {
  return apiFetch("/api/admin/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
}

export function disableTotp(code: string): Promise<TotpStatusResponse> {
  return apiFetch("/api/admin/totp/disable", { method: "POST", body: JSON.stringify({ code }) });
}
