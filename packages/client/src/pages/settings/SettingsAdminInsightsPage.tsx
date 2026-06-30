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
  AdminSummaryResponse,
  AdminSyncResponse,
} from "@timedata/shared";
import { type ReactNode, useEffect, useState } from "react";
import {
  deleteAdminBackup,
  fetchAdminAnalytics,
  fetchAdminBackups,
  fetchAdminCategories,
  fetchAdminEntries,
  fetchAdminHealthChecks,
  fetchAdminRequestLogs,
  fetchAdminSummary,
  fetchAdminSync,
  fetchBackupConfig,
  triggerDailyBackup,
  updateBackupConfig,
} from "../../lib/adminApi.ts";
import { SelectSheet, type SelectOption } from "../../components/ui/SelectSheet.js";
import { Switch } from "../../components/ui/Switch.js";
import { useConfirm } from "../../hooks/useConfirm.tsx";
import { formatAppDateTime } from "../../lib/time.ts";
import SettingsDetailPage from "./SettingsDetailPage.js";

interface AdminInsightsState {
  summary?: AdminSummaryResponse;
  entries?: AdminEntriesResponse;
  categories?: AdminCategoriesResponse;
  sync?: AdminSyncResponse;
  backups?: AdminBackupsResponse;
  backupConfig?: AdminBackupConfigResponse;
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

const statusFilterOptions: SelectOption<string>[] = [
  { value: "", label: "全部状态" },
  { value: "200", label: "200" },
  { value: "400", label: "400" },
  { value: "401", label: "401" },
  { value: "403", label: "403" },
  { value: "429", label: "429" },
  { value: "500", label: "500" },
];
const outcomeFilterOptions: SelectOption<string>[] = [
  { value: "", label: "全部结果" },
  ...requestOutcomeOptions.map((outcome) => ({ value: outcome, label: requestOutcomeLabel[outcome] })),
];
const tokenTierFilterOptions: SelectOption<string>[] = [
  { value: "", label: "全部层级" },
  ...tokenTierOptions.map((tier) => ({ value: tier, label: tokenTierLabel[tier] })),
];
const clientHintFilterOptions: SelectOption<string>[] = [
  { value: "", label: "全部客户端" },
  ...clientHintOptions.map((hint) => ({ value: hint, label: clientHintLabel[hint] })),
];
const inputClassName = "w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";
const secondaryButtonClassName =
  "rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-xs text-ink hover:bg-surface-hover disabled:opacity-40";
const dangerButtonClassName = "rounded-ctl bg-danger px-3 py-2 text-xs text-page hover:bg-danger/80 disabled:opacity-40";

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
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4">
      <h3 className="text-sm font-medium text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function SyncIssueBadge({ label }: { label: string }) {
  return <span className="rounded-pill bg-warn-soft px-2 py-0.5 text-[11px] text-warn">{label}</span>;
}

function FilterSelectSheet({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption<string>[];
}) {
  return (
    <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-xs text-ink-3">
      <span>{label}</span>
      <SelectSheet
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        className="min-h-10"
      />
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
          <thead className="text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">层级</th>
              <th className="px-3 py-2 font-medium">可访问范围</th>
              <th className="px-3 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-ink-2">
            {rows.map((row) => (
              <tr key={row.tier}>
                <td className="px-3 py-2 text-ink"><code>{row.tier}</code></td>
                <td className="px-3 py-2">{row.access}</td>
                <td className="px-3 py-2 text-ink-3">{row.notes}</td>
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
        <FilterSelectSheet
          label="请求状态"
          value={filters.status === undefined ? "" : String(filters.status)}
          onChange={(value) => updateFilter("status", value ? Number(value) : undefined)}
          options={statusFilterOptions}
        />
        <FilterSelectSheet
          label="请求结果"
          value={filters.outcome ?? ""}
          onChange={(value) => updateFilter("outcome", (value || undefined) as AdminRequestLogOutcome | undefined)}
          options={outcomeFilterOptions}
        />
        <FilterSelectSheet
          label="令牌层级"
          value={filters.tokenTier ?? ""}
          onChange={(value) => updateFilter("tokenTier", (value || undefined) as AdminRequestLogTokenTier | undefined)}
          options={tokenTierFilterOptions}
        />
        <FilterSelectSheet
          label="客户端提示"
          value={filters.clientHint ?? ""}
          onChange={(value) =>
            updateFilter("clientHint", (value || undefined) as AdminRequestLogClientHint | undefined)
          }
          options={clientHintFilterOptions}
        />
      </div>

      <p className="text-xs text-ink-3">
        IP 仅用于展示；反代未清洗 X-Forwarded-For / X-Real-IP 时不可作为安全证据。
      </p>

      {loading && <div className="text-sm text-ink-2">正在加载请求审计…</div>}
      {error && <div className="rounded-ctl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <div className="space-y-2">
        {logs?.logs.map((log) => (
          <div key={log.id} className="rounded-ctl bg-surface-elevated px-3 py-2 text-xs text-ink-2">
            <div className="flex flex-wrap items-center gap-2 text-ink">
              <code>{log.method}</code>
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
            {log.userAgent && <div className="mt-1 truncate text-ink-3">{log.userAgent}</div>}
          </div>
        ))}
        {logs && logs.logs.length === 0 && <div className="text-sm text-ink-3">暂无请求审计记录。</div>}
      </div>
    </Section>
  );
}

export default function SettingsAdminInsightsPage() {
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<AdminInsightsState | null>(null);
  const [backupConfig, setBackupConfig] = useState<AdminBackupConfigResponse["config"] | null>(null);
  const [backupActionStatus, setBackupActionStatus] = useState("");
  const [backupActionBusy, setBackupActionBusy] = useState(false);
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
        const [summaryR, entriesR, categoriesR, syncR, backupsR, backupConfigR, healthR, analyticsR] =
          await Promise.allSettled([
          fetchAdminSummary(),
          fetchAdminEntries({ limit: 10 }),
          fetchAdminCategories(),
          fetchAdminSync(),
          fetchAdminBackups(),
          fetchBackupConfig(),
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
          backupConfig: settledValue(backupConfigR, errors),
          health: settledValue(healthR, errors),
          analytics: settledValue(analyticsR, errors),
        };
        if (!cancelled) {
          setData(nextData);
          if (nextData.backupConfig) setBackupConfig(nextData.backupConfig.config);
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

  async function refreshBackups() {
    const backups = await fetchAdminBackups();
    setData((current) => (current ? { ...current, backups } : current));
  }

  async function handleSaveBackupConfig() {
    if (!backupConfig) return;
    setBackupActionBusy(true);
    setBackupActionStatus("");
    try {
      const response = await updateBackupConfig(backupConfig);
      setBackupConfig(response.config);
      setBackupActionStatus("备份设置已保存。");
    } catch (err) {
      setBackupActionStatus(`备份设置保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackupActionBusy(false);
    }
  }

  async function handleTriggerDailyBackup() {
    setBackupActionBusy(true);
    setBackupActionStatus("");
    try {
      const result = await triggerDailyBackup();
      setBackupActionStatus(
        result.created ? `已创建每日备份：${result.backupId}` : `未创建每日备份：${result.reason}`,
      );
      try {
        await refreshBackups();
      } catch (refreshError) {
        setBackupActionStatus(
          `日备操作已完成，但列表刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        );
      }
    } catch (err) {
      setBackupActionStatus(`每日备份触发失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackupActionBusy(false);
    }
  }

  async function handleDeleteBackup(id: string) {
    const confirmed = await confirm({
      title: "删除服务端备份",
      body: `确定删除备份 ${id}？此操作会删除服务器上的备份文件和 manifest 条目。`,
      confirmLabel: "删除备份",
      danger: true,
    });
    if (!confirmed) return;

    setBackupActionBusy(true);
    setBackupActionStatus("");
    try {
      await deleteAdminBackup(id);
      setBackupActionStatus(`已删除备份：${id}`);
      try {
        await refreshBackups();
      } catch (refreshError) {
        setBackupActionStatus(
          `已删除备份，但列表刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        );
      }
    } catch (err) {
      setBackupActionStatus(`备份删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackupActionBusy(false);
    }
  }

  return (
    <SettingsDetailPage title="服务端数据洞察">
      {dialog}
      <div className="rounded-card border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
        诊断数据只读查看；仅备份管理会修改服务器备份（创建、删除、配置）。
      </div>

      {loading && <div className="text-sm text-ink-2">正在加载服务端数据…</div>}
      {error && (
        <div className="rounded-card border border-danger/40 bg-danger-soft p-4 text-sm text-danger">{error}</div>
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
                  className="flex items-center justify-between gap-3 rounded-ctl bg-surface-elevated px-3 py-2 text-sm"
                >
                  <div>
                    <div className={check.severity === "error" ? "text-danger" : "text-warn"}>
                      {anomalyLabel[check.code] ?? check.code}
                    </div>
                    <div className="mt-1 text-xs text-ink-3">
                      样例：{check.sampleIds.length ? check.sampleIds.join("、") : "无"}
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-ink">{check.count}</div>
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
                  <span className="text-ink-2">{bucket.bucket}</span>
                  <span className="text-ink">
                    {minutesLabel(bucket.totalMinutes)} · {bucket.entryCount} 条
                  </span>
                </div>
              ))}
              <div className="border-t border-border pt-3">
                {data.analytics.byCategory.slice(0, 5).map((category) => (
                  <div key={category.categoryId} className="mt-2 flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="truncate">
                        {category.parentCategoryName
                          ? `${category.parentCategoryName} / ${category.categoryName}`
                          : category.categoryName}
                      </span>
                    </span>
                    <span className="shrink-0 text-ink">{minutesLabel(category.totalMinutes)}</span>
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
                <div key={entry.id} className="rounded-ctl bg-surface-elevated px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-ink">{entry.categoryName ?? entry.categoryId}</span>
                    <span className="shrink-0 text-xs text-ink-3">
                      {entry.durationMinutes === null ? "无效时段" : minutesLabel(entry.durationMinutes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {formatAppDateTime(entry.startTime)} - {formatAppDateTime(entry.endTime)}
                  </div>
                  {entry.anomaly && <div className="mt-1 text-xs text-warn">{anomalyLabel[entry.anomaly]}</div>}
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
                  <span className="min-w-0 truncate text-ink-2">
                    {category.parentName ? `${category.parentName} / ${category.name}` : category.name}
                  </span>
                  <span className="shrink-0 text-ink">
                    {minutesLabel(category.totalMinutes)} · {category.entryCount} 条
                  </span>
                </div>
              ))}
            </div>
            </Section>
          )}

          {data.sync && (
            <Section title="同步诊断">
              <div className="space-y-2 text-sm text-ink-2">
                <div>
                  最近拒绝 {data.sync.recentRejectedCount} 次，最近冲突 {data.sync.recentConflictCount} 次。
                </div>
                {data.sync.recentIssues.length > 0 && (
                <div className="space-y-2">
                  {data.sync.recentIssues.map((issue) => (
                    <div
                      key={`${issue.logId}:${issue.tableName}:${issue.localRecordId}`}
                      className="rounded-ctl bg-surface-elevated px-3 py-2 text-xs text-ink-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-ink-2">
                        <span>
                          {issue.tableName}/{issue.localRecordId}
                        </span>
                        <SyncIssueBadge label={issue.reasonCode} />
                        {issue.backupId && <SyncIssueBadge label="保护备份" />}
                      </div>
                      <div className="mt-1">{issue.message}</div>
                      <div className="mt-1 text-ink-3">
                        {formatAppDateTime(issue.timestamp)} · {issue.action} · 日志 #{issue.logId}
                      </div>
                      {issue.overriddenRecordIds.length > 0 && (
                        <div className="mt-1 text-ink-3">覆盖记录：{issue.overriddenRecordIds.join("、")}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {data.sync.logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="rounded-ctl bg-surface-elevated px-3 py-2 text-xs text-ink-2">
                    <div className="text-ink-2">
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
              {backupConfig && (
                <div className="space-y-3 rounded-ctl bg-surface-elevated p-3">
                  <div className="text-sm font-medium text-ink">备份设置</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-ink-3">每日定时备份</span>
                    <Switch
                      ariaLabel="每日定时备份"
                      checked={backupConfig.dailyBackup.enabled}
                      disabled={backupActionBusy}
                      onChange={(enabled) =>
                        setBackupConfig({
                          ...backupConfig,
                          dailyBackup: { ...backupConfig.dailyBackup, enabled },
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-ink-3">
                      定时时点
                      <input
                        aria-label="每日备份时点"
                        type="time"
                        value={backupConfig.dailyBackup.timeOfDay}
                        disabled={backupActionBusy}
                        onChange={(event) =>
                          setBackupConfig({
                            ...backupConfig,
                            dailyBackup: { ...backupConfig.dailyBackup, timeOfDay: event.target.value },
                          })
                        }
                        className={inputClassName}
                      />
                    </label>
                    <label className="space-y-1 text-xs text-ink-3">
                      保留天数
                      <input
                        aria-label="备份保留天数"
                        type="number"
                        min={1}
                        max={3650}
                        value={backupConfig.retentionDays}
                        disabled={backupActionBusy}
                        onChange={(event) =>
                          setBackupConfig({
                            ...backupConfig,
                            retentionDays: Number(event.target.value),
                          })
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={backupActionBusy}
                      onClick={() => void handleSaveBackupConfig()}
                      className={secondaryButtonClassName}
                    >
                      保存备份设置
                    </button>
                    <button
                      type="button"
                      disabled={backupActionBusy}
                      onClick={() => void handleTriggerDailyBackup()}
                      className={secondaryButtonClassName}
                    >
                      立即触发日备
                    </button>
                  </div>
                </div>
              )}
              {backupActionStatus && <div className="text-xs text-ink-3">{backupActionStatus}</div>}
              <div className="space-y-2">
                {data.backups.backups.slice(0, 8).map((backup) => (
                <div key={backup.id} className="rounded-ctl bg-surface-elevated px-3 py-2 text-xs text-ink-2">
                  <div className="flex flex-wrap items-center gap-2 text-ink-2">
                    <span className="truncate">{backup.fileName}</span>
                    {backup.protected && <SyncIssueBadge label="受保护" />}
                    {backup.reason && <SyncIssueBadge label={backup.reason} />}
                  </div>
                  <div className="mt-1">
                    {backup.operation} · {maybeDateTime(backup.createdAt)} · {backup.sizeBytes} bytes
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={backupActionBusy}
                      onClick={() => void handleDeleteBackup(backup.id)}
                      className={dangerButtonClassName}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
                {!data.backups.backups.length && <div className="text-sm text-ink-3">暂无服务端备份。</div>}
              </div>
            </Section>
          )}
        </>
      )}
    </SettingsDetailPage>
  );
}
