import { useEffect, useState, type ReactNode } from "react";
import type {
  AdminAnalyticsResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminSummaryResponse,
  AdminSyncResponse,
} from "@timedata/shared";
import {
  fetchAdminAnalytics,
  fetchAdminBackups,
  fetchAdminCategories,
  fetchAdminEntries,
  fetchAdminHealthChecks,
  fetchAdminSummary,
  fetchAdminSync,
} from "../../lib/adminApi.ts";
import { formatAppDateTime } from "../../lib/time.ts";
import SettingsDetailPage from "./SettingsDetailPage.js";

interface AdminInsightsState {
  summary: AdminSummaryResponse;
  entries: AdminEntriesResponse;
  categories: AdminCategoriesResponse;
  sync: AdminSyncResponse;
  backups: AdminBackupsResponse;
  health: AdminHealthChecksResponse;
  analytics: AdminAnalyticsResponse;
}

const anomalyLabel: Record<string, string> = {
  invalid_time_range: "时间范围异常",
  missing_category: "分类缺失",
  archived_category: "归档分类",
};

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

function maybeDateTime(value: string | null): string {
  return value ? formatAppDateTime(value) : "暂无";
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

function SyncIssueBadge({ label }: { label: string }) {
  return <span className="rounded bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-200">{label}</span>;
}

export default function SettingsAdminInsightsPage() {
  const [data, setData] = useState<AdminInsightsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [summary, entries, categories, sync, backups, health, analytics] = await Promise.all([
          fetchAdminSummary(),
          fetchAdminEntries({ limit: 10 }),
          fetchAdminCategories(),
          fetchAdminSync(),
          fetchAdminBackups(),
          fetchAdminHealthChecks(),
          fetchAdminAnalytics({ groupBy: "day" }),
        ]);
        if (!cancelled) {
          setData({ summary, entries, categories, sync, backups, health, analytics });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载服务端数据洞察失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsDetailPage title="服务端数据洞察">
      <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-4 text-sm text-blue-100">
        只读查看服务器 SQLite 数据、同步诊断、备份和健康检查；这里不会修改服务器数据。
      </div>

      {loading && <div className="text-sm text-slate-400">正在加载服务端数据…</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="时间记录" value={data.summary.counts.timeEntries} hint={`最近更新 ${maybeDateTime(data.summary.latest.entryUpdatedAt)}`} />
            <StatCard label="分类" value={data.summary.counts.categories} hint={`${data.summary.counts.activeCategories} 个启用 / ${data.summary.counts.archivedCategories} 个归档`} />
            <StatCard label="服务端备份" value={data.summary.counts.serverBackups} hint={`最近备份 ${maybeDateTime(data.summary.latest.backupCreatedAt)}`} />
            <StatCard label="同步日志" value={data.summary.counts.syncLogs} hint={`最近同步 ${maybeDateTime(data.summary.latest.syncLogTimestamp)}`} />
          </div>

          <Section title="数据健康检查">
            <div className="space-y-2">
              {data.health.checks.map((check) => (
                <div key={check.code} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950/50 px-3 py-2 text-sm">
                  <div>
                    <div className={check.severity === "error" ? "text-red-300" : "text-amber-300"}>{anomalyLabel[check.code] ?? check.code}</div>
                    <div className="mt-1 text-xs text-slate-500">样例：{check.sampleIds.length ? check.sampleIds.join("、") : "无"}</div>
                  </div>
                  <div className="text-lg font-semibold text-slate-100">{check.count}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="分析概览">
            <div className="space-y-3">
              {data.analytics.byTime.slice(-7).map((bucket) => (
                <div key={bucket.bucket} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{bucket.bucket}</span>
                  <span className="text-slate-100">{minutesLabel(bucket.totalMinutes)} · {bucket.entryCount} 条</span>
                </div>
              ))}
              <div className="border-t border-slate-800 pt-3">
                {data.analytics.byCategory.slice(0, 5).map((category) => (
                  <div key={category.categoryId} className="mt-2 flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="truncate">{category.parentCategoryName ? `${category.parentCategoryName} / ${category.categoryName}` : category.categoryName}</span>
                    </span>
                    <span className="shrink-0 text-slate-100">{minutesLabel(category.totalMinutes)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="最近记录">
            <div className="space-y-2">
              {data.entries.entries.map((entry) => (
                <div key={entry.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-slate-100">{entry.categoryName ?? entry.categoryId}</span>
                    <span className="shrink-0 text-xs text-slate-500">{entry.durationMinutes === null ? "无效时段" : minutesLabel(entry.durationMinutes)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatAppDateTime(entry.startTime)} - {formatAppDateTime(entry.endTime)}</div>
                  {entry.anomaly && <div className="mt-1 text-xs text-amber-300">{anomalyLabel[entry.anomaly]}</div>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="分类汇总">
            <div className="space-y-2">
              {data.categories.categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-slate-300">{category.parentName ? `${category.parentName} / ${category.name}` : category.name}</span>
                  <span className="shrink-0 text-slate-100">{minutesLabel(category.totalMinutes)} · {category.entryCount} 条</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="同步诊断">
            <div className="space-y-2 text-sm text-slate-300">
              <div>最近拒绝 {data.sync.recentRejectedCount} 次，最近冲突 {data.sync.recentConflictCount} 次。</div>
              {data.sync.recentIssues.length > 0 && (
                <div className="space-y-2">
                  {data.sync.recentIssues.map((issue) => (
                    <div key={`${issue.logId}:${issue.tableName}:${issue.localRecordId}`} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                      <div className="flex flex-wrap items-center gap-2 text-slate-200">
                        <span>{issue.tableName}/{issue.localRecordId}</span>
                        <SyncIssueBadge label={issue.reasonCode} />
                        {issue.backupId && <SyncIssueBadge label="保护备份" />}
                      </div>
                      <div className="mt-1">{issue.message}</div>
                      <div className="mt-1 text-slate-500">{formatAppDateTime(issue.timestamp)} · {issue.action} · 日志 #{issue.logId}</div>
                      {issue.overriddenRecordIds.length > 0 && <div className="mt-1 text-slate-500">覆盖记录：{issue.overriddenRecordIds.join("、")}</div>}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {data.sync.logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                    <div className="text-slate-200">{log.action} · {log.device ?? "unknown"} · {log.recordCount} 条</div>
                    <div className="mt-1">{formatAppDateTime(log.timestamp)}</div>
                    {log.detail && <div className="mt-1 truncate">{log.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="服务端备份">
            <div className="space-y-2">
              {data.backups.backups.slice(0, 8).map((backup) => (
                <div key={backup.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                  <div className="flex flex-wrap items-center gap-2 text-slate-200">
                    <span className="truncate">{backup.fileName}</span>
                    {backup.protected && <SyncIssueBadge label="受保护" />}
                    {backup.reason && <SyncIssueBadge label={backup.reason} />}
                  </div>
                  <div className="mt-1">{backup.operation} · {maybeDateTime(backup.createdAt)} · {backup.sizeBytes} bytes</div>
                </div>
              ))}
              {!data.backups.backups.length && <div className="text-sm text-slate-500">暂无服务端备份。</div>}
            </div>
          </Section>
        </>
      )}
    </SettingsDetailPage>
  );
}
