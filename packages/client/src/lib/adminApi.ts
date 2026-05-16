import type {
  AdminAnalyticsResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminSummaryResponse,
  AdminSyncResponse,
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

export function fetchAdminHealthChecks(): Promise<AdminHealthChecksResponse> {
  return apiFetch("/api/admin/health-checks");
}

export function fetchAdminAnalytics(query: AdminAnalyticsQuery = {}): Promise<AdminAnalyticsResponse> {
  return apiFetch(withQuery("/api/admin/analytics", query));
}
