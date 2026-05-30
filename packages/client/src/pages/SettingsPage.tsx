import type { VersionInfo } from "@timedata/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { type AndroidApkUpdate, fetchAndroidApkUpdate, openAndroidApkUpdate } from "../lib/mobileUpdate.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { fetchServerHealth } from "../lib/serverHealth.ts";
import { fetchServerVersion, fetchUpdateStatus, triggerServerUpdate } from "../lib/serverVersion.ts";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { formatAppDateTime } from "../lib/time.ts";
import type { RegularSyncResult } from "../sync/engine.ts";

type ServerConnectionColor = "green" | "gray" | "red";

type ServerVersionState = { ok: true; version: VersionInfo } | { ok: false; error: string };

export type ServerHealthState = "checking" | "ok" | "fail";

interface ServerConnectionState {
  color: ServerConnectionColor;
  subtitle: string;
}

export function getServerConnectionState(apiUrl: string, health: ServerHealthState): ServerConnectionState {
  if (!apiUrl) {
    return { color: "gray", subtitle: "未配置服务器" };
  }
  if (health === "ok") {
    return { color: "green", subtitle: "服务器已连接" };
  }
  if (health === "fail") {
    return { color: "red", subtitle: "服务器连接失败" };
  }
  return { color: "gray", subtitle: "正在检查服务器" };
}

function statusDotClass(color: ServerConnectionColor): string {
  if (color === "green") return "bg-emerald-400";
  if (color === "red") return "bg-red-400";
  return "bg-slate-500";
}

function SettingsLinkRow({
  to,
  title,
  subtitle,
  accessory,
}: {
  to: string;
  title: string;
  subtitle?: string;
  accessory?: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 hover:bg-slate-900"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-100">{title}</div>
        {subtitle && <div className="mt-1 truncate text-xs text-slate-500">{subtitle}</div>}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-2 text-xs text-slate-500">
        {accessory && <span>{accessory}</span>}
        <span className="text-lg leading-none text-slate-500">›</span>
      </div>
    </Link>
  );
}

function SettingsActionRow({
  title,
  subtitle,
  accessory,
  disabled,
  onClick,
}: {
  title: string;
  subtitle?: string;
  accessory?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-left hover:bg-slate-900 disabled:opacity-60"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-100">{title}</div>
        {subtitle && <div className="mt-1 truncate text-xs text-slate-500">{subtitle}</div>}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-2 text-xs text-slate-500">
        {accessory && <span>{accessory}</span>}
        <span className="text-lg leading-none text-slate-500">›</span>
      </div>
    </button>
  );
}

function SyncIssueList({ issues }: { issues: NonNullable<RegularSyncResult["pushIssues"]> }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-1 rounded border border-amber-900 bg-amber-950/30 p-2 text-amber-100">
      <p>需要处理的同步项：</p>
      {issues.map((issue) => (
        <p key={`${issue.tableName}:${issue.recordId}:${issue.action}`}>
          {issue.tableName}/{issue.recordId}: {issue.reasonCode} — {issue.message}
        </p>
      ))}
    </div>
  );
}

function CloudSyncSummary() {
  const { syncing, lastSynced, unsyncedCount, error, conflicts, lastResult, sync } = useSyncContext();

  return (
    <section className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-blue-100">同步信息</h3>
          <div className="mt-2 space-y-1 text-xs text-slate-300">
            <p>上次同步: {lastSynced ? formatAppDateTime(lastSynced) : "从未"}</p>
            <p>待同步: {unsyncedCount} 条</p>
            {lastResult?.identical && <p className="text-emerald-300">本地与云端数据一致，无需同步。</p>}
            {lastResult && !lastResult.identical && !conflicts.length && (
              <p className="text-emerald-300">
                已推送 {lastResult.pushed} 条，已拉取 {lastResult.pulled} 条
              </p>
            )}
            {lastResult && lastResult.rejected > 0 && <p className="text-red-300">云端拒绝 {lastResult.rejected} 条</p>}
            {lastResult && lastResult.pushConflicts > 0 && (
              <p className="text-amber-300">云端冲突 {lastResult.pushConflicts} 条</p>
            )}
            {lastResult?.pushIssues && <SyncIssueList issues={lastResult.pushIssues} />}
            {conflicts.length > 0 && (
              <p className="text-amber-300">发现 {conflicts.length} 条冲突，请到数据设置处理。</p>
            )}
            {error && <p className="text-red-300">{error}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {syncing ? "同步中…" : "同步"}
        </button>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { apiUrl, cloudSyncEnabled } = useSyncContext();
  const { confirm, dialog } = useConfirm();
  const [serverVersion, setServerVersion] = useState<ServerVersionState | null>(null);
  const [, setServerChecked] = useState(!apiUrl);
  const [serverHealth, setServerHealth] = useState<ServerHealthState>(() =>
    apiUrl && safeGetItem(STORAGE_KEYS.serverHealthy) === "1" ? "ok" : "checking",
  );
  const [serverUpdating, setServerUpdating] = useState(false);
  const [serverUpdateStatus, setServerUpdateStatus] = useState("");
  const [apkChecking, setApkChecking] = useState(false);
  const [apkUpdate, setApkUpdate] = useState<AndroidApkUpdate | null>(null);
  const [apkStatus, setApkStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!apiUrl) return;

    fetchServerVersion().then((version) => {
      if (cancelled) return;
      setServerVersion(version);
      setServerChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!apiUrl) return;
    // 已知 ok 时保持乐观显示，不回退到“正在检查”闪烁
    setServerHealth((prev) => (prev === "ok" ? prev : "checking"));
    fetchServerHealth().then((ok) => {
      if (cancelled) return;
      setServerHealth(ok ? "ok" : "fail");
      safeSetItem(STORAGE_KEYS.serverHealthy, ok ? "1" : "0");
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const connectionState = getServerConnectionState(apiUrl, serverHealth);

  async function handleCheckApkUpdate() {
    setApkChecking(true);
    setApkStatus("正在检查 APK 更新…");
    try {
      const update = await fetchAndroidApkUpdate(__TIMEDATA_ANDROID_VERSION_CODE__);
      setApkUpdate(update);
      if (!update) {
        setApkStatus("还没有可下载的 Android APK Release。");
        return;
      }
      if (update.hasUpdate) {
        setApkStatus(`发现新 APK：${update.versionCode}`);
        await openAndroidApkUpdate(update);
        return;
      }
      setApkStatus(`当前 APK 已是最新版本：${__TIMEDATA_ANDROID_VERSION_CODE__}`);
    } catch (e: unknown) {
      setApkStatus(e instanceof Error ? e.message : "检查 APK 更新失败");
      setApkUpdate(null);
    } finally {
      setApkChecking(false);
    }
  }

  async function refreshServerVersion() {
    if (!apiUrl) return;
    setServerChecked(false);
    const version = await fetchServerVersion();
    setServerVersion(version);
    setServerChecked(true);
  }

  async function handleServerUpdate() {
    if (!apiUrl) return;

    if (!serverVersion) {
      await refreshServerVersion();
      return;
    }

    if (!serverVersion.ok) {
      setServerUpdateStatus(serverVersion.error);
      return;
    }

    const version = serverVersion.version;

    if (!version.hasUpdate) {
      setServerUpdateStatus("服务端已是最新版本。");
      return;
    }

    if (
      !(await confirm({
        title: "确认服务端更新",
        body: `确认更新到 ${version.latest}？过程中页面会短暂不可用。`,
        danger: false,
      }))
    )
      return;

    setServerUpdating(true);
    setServerUpdateStatus("已发起更新…");
    const updateId = await triggerServerUpdate();
    if (!updateId) {
      setServerUpdating(false);
      setServerUpdateStatus("触发失败，请检查 token 是否正确。");
      return;
    }

    setServerUpdateStatus(`更新任务已启动：${updateId}`);
    const status = await fetchUpdateStatus();
    if (status?.logTail) {
      setServerUpdateStatus(`更新任务：${status.updateId}\n${status.logTail.slice(-500)}`);
    }
    setServerUpdating(false);
  }

  return (
    <div className="space-y-4 p-4">
      {dialog}
      <h2 className="text-lg font-medium">设置</h2>

      <section className="space-y-3">
        <Link
          to="/settings/server"
          className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 hover:bg-slate-900"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(connectionState.color)}`} />
              <span>服务器配置</span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">{connectionState.subtitle}</div>
          </div>
          <span className="ml-3 text-lg leading-none text-slate-500">›</span>
        </Link>

        {cloudSyncEnabled && <CloudSyncSummary />}

        <SettingsLinkRow to="/settings/categories" title="分类管理" subtitle="新增、排序、改色、子分类与删除" />
        <SettingsLinkRow to="/settings/insights" title="数据洞察" subtitle="设置睡眠分类，用于作息、覆盖率和异常判定" />
        <SettingsLinkRow to="/settings/data" title="数据设置" subtitle="云同步、显示、备份与高级数据恢复" />
        <SettingsLinkRow
          to="/settings/admin-insights"
          title="服务端数据洞察"
          subtitle="只读查看服务器数据、同步、备份和健康检查"
        />
        <SettingsActionRow
          title="APK 更新"
          subtitle={apkStatus || `当前版本：${__TIMEDATA_ANDROID_VERSION_CODE__}`}
          accessory={apkUpdate?.hasUpdate ? apkUpdate.versionCode : undefined}
          disabled={apkChecking}
          onClick={handleCheckApkUpdate}
        />
        <SettingsActionRow
          title="服务端更新"
          subtitle={
            serverUpdateStatus ||
            (serverVersion?.ok
              ? `当前 ${serverVersion.version.current} / 最新 ${serverVersion.version.latest}`
              : connectionState.subtitle)
          }
          accessory={serverVersion?.ok && serverVersion.version.hasUpdate ? "有新版本" : undefined}
          disabled={serverUpdating || !apiUrl}
          onClick={handleServerUpdate}
        />
      </section>
    </div>
  );
}
