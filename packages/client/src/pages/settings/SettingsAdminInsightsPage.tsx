import type {
  AdminAnalyticsResponse,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminEntriesResponse,
  AdminHealthChecksResponse,
  AdminRequestLogClientHint,
  AdminRequestLogOutcome,
  AdminRequestLogsResponse,
  AdminRequestLogTokenTier,
  AdminSummaryResponse,
  AdminSyncResponse,
} from "@timedata/shared";
import { type ReactNode, useEffect, useState } from "react";
import {
  fetchAdminAnalytics,
  fetchAdminBackups,
  fetchAdminCategories,
  fetchAdminEntries,
  fetchAdminHealthChecks,
  fetchAdminRequestLogs,
  fetchAdminSummary,
  fetchAdminSync,
} from "../../lib/adminApi.ts";
import { formatAppDateTime } from "../../lib/time.ts";
import SettingsDetailPage from "./SettingsDetailPage.js";

interface AdminInsightsState {
  summary?: AdminSummaryResponse;
  entries?: AdminEntriesResponse;
  categories?: AdminCategoriesResponse;
  sync?: AdminSyncResponse;
  backups?: AdminBackupsResponse;
  health?: AdminHealthChecksResponse;
  analytics?: AdminAnalyticsResponse;
}

interface RequestLogFilters {
  limit: number;
  status?: number;
  outcome?: AdminRequestLogOutcome;
  tokenTier?: AdminRequestLogTokenTier;
  clientHint?: AdminRequestLogClientHint;
}

function settledValue<T>(result: PromiseSettledResult<T>, errors: string[]): T | undefined {
  if (result.status === "fulfilled") return result.value;
  errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  return undefined;
}

const anomalyLabel: Record<string, string> = {
  invalid_time_range: "时间范围异常",
  missing_category: "分类缺失",
  archived_category: "归档分类",
};

const requestOutcomeLabel: Record<AdminRequestLogOutcome, string> = {
  ok: "通过",
  auth_failed: "认证失败",
  rate_limited: "限流",
  server_error: "服务端错误",
  client_error: "客户端错误",
};

const tokenTierLabel: Record<AdminRequestLogTokenTier, string> = {
  public: "公开",
  master: "主令牌",
  agent: "Agent",
  dev_bypass: "开发绕过",
  missing: "缺失",
  invalid: "无效",
  unknown: "未知",
};

const clientHintLabel: Record<AdminRequestLogClientHint, string> = {
  web: "Web",
  android: "Android",
  cli: "CLI",
  agent: "Agent",
  unknown: "未知",
};

const requestOutcomeOptions: AdminRequestLogOutcome[] = [
  "ok",
  "auth_failed",
  "rate_limited",
  "server_error",
  "client_error",
];
const tokenTierOptions: AdminRequestLogTokenTier[] = [
  "public",
  "master",
  "agent",
  "dev_bypass",
  "missing",
  "invalid",
  "unknown",
];
const clientHintOptions: AdminRequestLogClientHint[] = ["web", "android", "cli", "agent", "unknown"];

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

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-xs text-slate-500">
      <span>{label}</span>
      <select
        aria-label={label}
        className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {children}
      </select>
    </label>
  );
}

function PermissionMatrix() {
  const rows = [
    { tier: "public", access: "健康检查、版本信息", notes: "不读取个人数据。" },
    { tier: "master", access: "同步、数据管理、Admin 洞察", notes: "唯一可读取请求审计的令牌层级。" },
    { tier: "agent", access: "受控 agent 写入端点", notes: "不可读取 `/api/admin/*`。" },
  ];

  return (
    <Section title="权限矩阵">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">层级</th>
              <th className="px-3 py-2 font-medium">可访问范围</th>
              <th className="px-3 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {rows.map((row) => (
              <tr key={row.tier}>
                <td className="px-3 py-2 font-mono text-slate-100">{row.tier}</td>
                <td className="px-3 py-2">{row.access}</td>
                <td className="px-3 py-2 text-slate-500">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function RequestAuditSection({
  logs,
  filters,
  loading,
  error,
  onFiltersChange,
}: {
  logs?: AdminRequestLogsResponse;
  filters: RequestLogFilters;
  loading: boolean;
  error: string;
  onFiltersChange: (filters: RequestLogFilters) => void;
}) {
  const updateFilter = <K extends keyof RequestLogFilters>(key: K, value: RequestLogFilters[K] | undefined) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  return (
    <Section title="请求审计">
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="请求状态"
          value={filters.status === undefined ? "" : String(filters.status)}
          onChange={(value) => updateFilter("status", value ? Number(value) : undefined)}
        >
          <option value="">全部状态</option>
          <option value="200">200</option>
          <option value="400">400</option>
          <option value="401">401</option>
          <option value="403">403</option>
          <option value="429">429</option>
          <option value="500">500</option>
        </FilterSelect>
        <FilterSelect
          label="请求结果"
          value={filters.outcome ?? ""}
          onChange={(value) => updateFilter("outcome", (value || undefined) as AdminRequestLogOutcome | undefined)}
        >
          <option value="">全部结果</option>
          {requestOutcomeOptions.map((outcome) => (
            <option key={outcome} value={outcome}>
              {requestOutcomeLabel[outcome]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="令牌层级"
          value={filters.tokenTier ?? ""}
          onChange={(value) => updateFilter("tokenTier", (value || undefined) as AdminRequestLogTokenTier | undefined)}
        >
          <option value="">全部层级</option>
          {tokenTierOptions.map((tier) => (
            <option key={tier} value={tier}>
              {tokenTierLabel[tier]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="客户端提示"
          value={filters.clientHint ?? ""}
          onChange={(value) =>
            updateFilter("clientHint", (value || undefined) as AdminRequestLogClientHint | undefined)
          }
        >
          <option value="">全部客户端</option>
          {clientHintOptions.map((hint) => (
            <option key={hint} value={hint}>
              {clientHintLabel[hint]}
            </option>
          ))}
        </FilterSelect>
      </div>

      <p className="text-xs text-slate-500">
        IP 仅用于展示；反代未清洗 X-Forwarded-For / X-Real-IP 时不可作为安全证据。
      </p>

      {loading && <div className="text-sm text-slate-400">正在加载请求审计…</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>}

      <div className="space-y-2">
        {logs?.logs.map((log) => (
          <div key={log.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-2 text-slate-100">
              <span className="font-mono">{log.method}</span>
              <span className="min-w-0 break-all">{log.path}</span>
              <SyncIssueBadge label={String(log.status)} />
              <SyncIssueBadge label={log.outcome} />
              <SyncIssueBadge label={log.tokenTier} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span>{formatAppDateTime(log.timestamp)}</span>
              <span>IP：{log.ip ?? "未知"}</span>
              <span>设备：{log.deviceLabel ?? clientHintLabel[log.clientHint]}</span>
              <span>{log.durationMs} ms</span>
            </div>
            {log.userAgent && <div className="mt-1 truncate text-slate-500">{log.userAgent}</div>}
          </div>
        ))}
        {logs && logs.logs.length === 0 && <div className="text-sm text-slate-500">暂无请求审计记录。</div>}
      </div>
    </Section>
  );
}

export default function SettingsAdminInsightsPage() {
  const [data, setData] = useState<AdminInsightsState | null>(null);
  const [requestLogs, setRequestLogs] = useState<AdminRequestLogsResponse | undefined>();
  const [requestLogFilters, setRequestLogFilters] = useState<RequestLogFilters>({ limit: 100 });
  const [requestLogsLoading, setRequestLogsLoading] = useState(true);
  const [requestLogsError, setRequestLogsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [summaryR, entriesR, categoriesR, syncR, backupsR, healthR, analyticsR] = await Promise.allSettled([
          fetchAdminSummary(),
          fetchAdminEntries({ limit: 10 }),
          fetchAdminCategories(),
          fetchAdminSync(),
          fetchAdminBackups(),
          fetchAdminHealthChecks(),
          fetchAdminAnalytics({ groupBy: "day" }),
        ]);
        const errors: string[] = [];
        const nextData: AdminInsightsState = {
          summary: settledValue(summaryR, errors),
          entries: settledValue(entriesR, errors),
          categories: settledValue(categoriesR, errors),
          sync: settledValue(syncR, errors),
          backups: settledValue(backupsR, errors),
          health: settledValue(healthR, errors),
          analytics: settledValue(analyticsR, errors),
        };
        if (!cancelled) {
          setData(nextData);
          setError(errors.length ? `部分服务端洞察加载失败：${errors.join("；")}` : "");
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

  useEffect(() => {
    let cancelled = false;
    async function loadRequestLogs() {
      setRequestLogsLoading(true);
      setRequestLogsError("");
      try {
        const nextLogs = await fetchAdminRequestLogs(requestLogFilters);
        if (!cancelled) {
          setRequestLogs(nextLogs);
        }
      } catch (err) {
        if (!cancelled) {
          setRequestLogsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setRequestLogsLoading(false);
        }
      }
    }
    void loadRequestLogs();
    return () => {
      cancelled = true;
    };
  }, [requestLogFilters]);

  return (
    <SettingsDetailPage title="服务端数据洞察">
      <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-4 text-sm text-blue-100">
        只读查看服务器 SQLite 数据、同步诊断、备份和健康检查；这里不会修改服务器数据。
      </div>

      {loading && <div className="text-sm text-slate-400">正在加载服务端数据…</div>}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">{error}</div>
      )}

      {data && (
        <>
          {data.summary && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="时间记录"
                value={data.summary.counts.timeEntries}
                hint={`最近更新 ${maybeDateTime(data.summary.latest.entryUpdatedAt)}`}
              />
              <StatCard
                label="分类"
                value={data.summary.counts.categories}
                hint={`${data.summary.counts.activeCategories} 个启用 / ${data.summary.counts.archivedCategories} 个归档`}
              />
              <StatCard
                label="服务端备份"
                value={data.summary.counts.serverBackups}
                hint={`最近备份 ${maybeDateTime(data.summary.latest.backupCreatedAt)}`}
              />
              <StatCard
                label="同步日志"
                value={data.summary.counts.syncLogs}
                hint={`最近同步 ${maybeDateTime(data.summary.latest.syncLogTimestamp)}`}
              />
            </div>
          )}

          {data.health && (
            <Section title="数据健康检查">
              <div className="space-y-2">
                {data.health.checks.map((check) => (
                <div
                  key={check.code}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-950/50 px-3 py-2 text-sm"
                >
                  <div>
                    <div className={check.severity === "error" ? "text-red-300" : "text-amber-300"}>
                      {anomalyLabel[check.code] ?? check.code}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      样例：{check.sampleIds.length ? check.sampleIds.join("、") : "无"}
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-slate-100">{check.count}</div>
                </div>
              ))}
            </div>
            </Section>
          )}

          {data.analytics && (
            <Section title="分析概览">
              <div className="space-y-3">
                {data.analytics.byTime.slice(-7).map((bucket) => (
                <div key={bucket.bucket} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{bucket.bucket}</span>
                  <span className="text-slate-100">
                    {minutesLabel(bucket.totalMinutes)} · {bucket.entryCount} 条
                  </span>
                </div>
              ))}
              <div className="border-t border-slate-800 pt-3">
                {data.analytics.byCategory.slice(0, 5).map((category) => (
                  <div key={category.categoryId} className="mt-2 flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="truncate">
                        {category.parentCategoryName
                          ? `${category.parentCategoryName} / ${category.categoryName}`
                          : category.categoryName}
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-100">{minutesLabel(category.totalMinutes)}</span>
                  </div>
                ))}
              </div>
            </div>
            </Section>
          )}

          {data.entries && (
            <Section title="最近记录">
              <div className="space-y-2">
                {data.entries.entries.map((entry) => (
                <div key={entry.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-slate-100">{entry.categoryName ?? entry.categoryId}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {entry.durationMinutes === null ? "无效时段" : minutesLabel(entry.durationMinutes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatAppDateTime(entry.startTime)} - {formatAppDateTime(entry.endTime)}
                  </div>
                  {entry.anomaly && <div className="mt-1 text-xs text-amber-300">{anomalyLabel[entry.anomaly]}</div>}
                </div>
              ))}
            </div>
            </Section>
          )}

          {data.categories && (
            <Section title="分类汇总">
              <div className="space-y-2">
                {data.categories.categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-slate-300">
                    {category.parentName ? `${category.parentName} / ${category.name}` : category.name}
                  </span>
                  <span className="shrink-0 text-slate-100">
                    {minutesLabel(category.totalMinutes)} · {category.entryCount} 条
                  </span>
                </div>
              ))}
            </div>
            </Section>
          )}

          {data.sync && (
            <Section title="同步诊断">
              <div className="space-y-2 text-sm text-slate-300">
                <div>
                  最近拒绝 {data.sync.recentRejectedCount} 次，最近冲突 {data.sync.recentConflictCount} 次。
                </div>
                {data.sync.recentIssues.length > 0 && (
                <div className="space-y-2">
                  {data.sync.recentIssues.map((issue) => (
                    <div
                      key={`${issue.logId}:${issue.tableName}:${issue.localRecordId}`}
                      className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-slate-200">
                        <span>
                          {issue.tableName}/{issue.localRecordId}
                        </span>
                        <SyncIssueBadge label={issue.reasonCode} />
                        {issue.backupId && <SyncIssueBadge label="保护备份" />}
                      </div>
                      <div className="mt-1">{issue.message}</div>
                      <div className="mt-1 text-slate-500">
                        {formatAppDateTime(issue.timestamp)} · {issue.action} · 日志 #{issue.logId}
                      </div>
                      {issue.overriddenRecordIds.length > 0 && (
                        <div className="mt-1 text-slate-500">覆盖记录：{issue.overriddenRecordIds.join("、")}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {data.sync.logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                    <div className="text-slate-200">
                      {log.action} · {log.device ?? "unknown"} · {log.recordCount} 条
                    </div>
                    <div className="mt-1">{formatAppDateTime(log.timestamp)}</div>
                    {log.detail && <div className="mt-1 truncate">{log.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
            </Section>
          )}

          <RequestAuditSection
            logs={requestLogs}
            filters={requestLogFilters}
            loading={requestLogsLoading}
            error={requestLogsError}
            onFiltersChange={setRequestLogFilters}
          />

          <PermissionMatrix />

          {data.backups && (
            <Section title="服务端备份">
              <div className="space-y-2">
                {data.backups.backups.slice(0, 8).map((backup) => (
                <div key={backup.id} className="rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                  <div className="flex flex-wrap items-center gap-2 text-slate-200">
                    <span className="truncate">{backup.fileName}</span>
                    {backup.protected && <SyncIssueBadge label="受保护" />}
                    {backup.reason && <SyncIssueBadge label={backup.reason} />}
                  </div>
                  <div className="mt-1">
                    {backup.operation} · {maybeDateTime(backup.createdAt)} · {backup.sizeBytes} bytes
                  </div>
                </div>
              ))}
                {!data.backups.backups.length && <div className="text-sm text-slate-500">暂无服务端备份。</div>}
              </div>
            </Section>
          )}
        </>
      )}
    </SettingsDetailPage>
  );
}
