import type { VersionInfo } from "@timedata/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { type AndroidApkUpdate, fetchAndroidApkUpdate, openAndroidApkUpdate } from "../lib/mobileUpdate.ts";
import { fetchServerVersion, fetchUpdateStatus, triggerServerUpdate } from "../lib/serverVersion.ts";
import type { SyncStreamState } from "../lib/syncStream.js";
import { formatAppDateTime } from "../lib/time.ts";
import type { RegularSyncResult } from "../sync/engine.ts";
import {
  ChevronRightIcon,
  CloudIcon,
  DatabaseIcon,
  MoonIcon,
  RefreshIcon,
  ServerIcon,
  SmartphoneIcon,
  TagIcon,
} from "./settings/SettingsIcons.tsx";

type ServerConnectionColor = "green" | "gray" | "red" | "yellow";

type ServerVersionState = { ok: true; version: VersionInfo } | { ok: false; error: string };

interface ServerConnectionState {
  color: ServerConnectionColor;
  subtitle: string;
}

export function getServerConnectionState(apiUrl: string, connection: SyncStreamState): ServerConnectionState {
  if (!apiUrl) {
    return { color: "gray", subtitle: "未配置服务器" };
  }
  if (connection === "connected") {
    return { color: "green", subtitle: "服务器已连接" };
  }
  if (connection === "connecting") {
    return { color: "yellow", subtitle: "正在连接服务器" };
  }
  return { color: "red", subtitle: "服务器未连接" };
}

function statusDotClass(color: ServerConnectionColor): string {
  if (color === "green") return "bg-emerald-400";
  if (color === "yellow") return "bg-amber-400";
  if (color === "red") return "bg-red-400";
  return "bg-slate-500";
}

// 图标徽章配色：用完整类名字符串，避免 Tailwind 动态拼接被裁剪。
type RowAccent = "sky" | "emerald" | "violet" | "amber" | "rose" | "blue";

const ACCENT_BADGE: Record<RowAccent, string> = {
  sky: "bg-sky-500/15 text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  violet: "bg-violet-500/15 text-violet-300",
  amber: "bg-amber-500/15 text-amber-300",
  rose: "bg-rose-500/15 text-rose-300",
  blue: "bg-blue-500/15 text-blue-300",
};

function ConnectionLight({ color }: { color: ServerConnectionColor }) {
  const dot = statusDotClass(color);
  return (
    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
      <span className={`absolute h-2.5 w-2.5 rounded-full opacity-50 blur-[3px] ${dot}`} />
      <span className={`relative h-2 w-2 rounded-full ${dot}`} />
    </span>
  );
}

function RowBody({
  icon,
  accent,
  title,
  subtitle,
  accessory,
}: {
  icon: ReactNode;
  accent: RowAccent;
  title: string;
  subtitle?: string;
  accessory?: string;
}) {
  return (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ACCENT_BADGE[accent]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-100">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {accessory && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
            {accessory}
          </span>
        )}
        <ChevronRightIcon className="h-4 w-4 text-slate-600" />
      </div>
    </>
  );
}

function SettingsGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {label && <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-slate-500">{label}</h3>}
      <div className="divide-y divide-slate-800/70 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
        {children}
      </div>
    </section>
  );
}

function SettingsLinkRow({
  to,
  icon,
  accent,
  title,
  subtitle,
  accessory,
}: {
  to: string;
  icon: ReactNode;
  accent: RowAccent;
  title: string;
  subtitle?: string;
  accessory?: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-800/50 active:bg-slate-800/70"
    >
      <RowBody icon={icon} accent={accent} title={title} subtitle={subtitle} accessory={accessory} />
    </Link>
  );
}

function SettingsActionRow({
  icon,
  accent,
  title,
  subtitle,
  accessory,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  accent: RowAccent;
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
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/50 active:bg-slate-800/70 disabled:opacity-60"
    >
      <RowBody icon={icon} accent={accent} title={title} subtitle={subtitle} accessory={accessory} />
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

// 状态总览卡：把"服务器连接"与"同步信息"合并为一张卡，连接在上、同步在下。
function ServerStatusCard() {
  const {
    apiUrl,
    connection,
    cloudSyncEnabled,
    syncing,
    lastSynced,
    unsyncedCount,
    error,
    conflicts,
    lastResult,
    sync,
  } = useSyncContext();
  const connectionState = getServerConnectionState(apiUrl, connection);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/30">
      <Link to="/settings/server" className="flex items-center gap-3 p-4 transition-colors hover:bg-slate-800/40">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-800/70 text-slate-200">
          <CloudIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-slate-100">服务器配置</span>
            <ConnectionLight color={connectionState.color} />
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-400">{connectionState.subtitle}</div>
        </div>
        <ChevronRightIcon className="h-5 w-5 text-slate-500" />
      </Link>

      {cloudSyncEnabled && (
        <div className="border-t border-slate-800/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-blue-100">同步信息</h3>
            <button
              type="button"
              onClick={sync}
              disabled={syncing}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {syncing ? "同步中…" : "同步"}
            </button>
          </div>
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
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { apiUrl, connection } = useSyncContext();
  const { confirm, dialog } = useConfirm();
  const [serverVersion, setServerVersion] = useState<ServerVersionState | null>(null);
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
    });

    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const connectionState = getServerConnectionState(apiUrl, connection);

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
    const version = await fetchServerVersion();
    setServerVersion(version);
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
    <div className="mx-auto max-w-xl space-y-5 p-4 pb-10">
      {dialog}
      <header className="px-1 pt-1">
        <h2 className="text-2xl font-semibold text-slate-100">设置</h2>
      </header>

      {/* 状态总览：服务器连接 + 同步摘要合并为一张卡（顺序：服务器配置 → 同步信息） */}
      <ServerStatusCard />

      <SettingsGroup label="记录与数据">
        <SettingsLinkRow
          to="/settings/categories"
          icon={<TagIcon />}
          accent="violet"
          title="分类管理"
          subtitle="新增、排序、改色、子分类与删除"
        />
        <SettingsLinkRow
          to="/settings/insights"
          icon={<MoonIcon />}
          accent="sky"
          title="数据洞察"
          subtitle="设置睡眠分类，用于作息、覆盖率和异常判定"
        />
        <SettingsLinkRow
          to="/settings/data"
          icon={<DatabaseIcon />}
          accent="emerald"
          title="数据设置"
          subtitle="云同步、显示、备份与高级数据恢复"
        />
      </SettingsGroup>

      <SettingsGroup label="服务端与更新">
        <SettingsLinkRow
          to="/settings/admin-insights"
          icon={<ServerIcon />}
          accent="blue"
          title="服务端数据洞察"
          subtitle="只读查看服务器数据、同步、备份和健康检查"
        />
        <SettingsActionRow
          icon={<SmartphoneIcon />}
          accent="amber"
          title="APK 更新"
          subtitle={apkStatus || `当前版本：${__TIMEDATA_ANDROID_VERSION_CODE__}`}
          accessory={apkUpdate?.hasUpdate ? apkUpdate.versionCode : undefined}
          disabled={apkChecking}
          onClick={handleCheckApkUpdate}
        />
        <SettingsActionRow
          icon={<RefreshIcon />}
          accent="rose"
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
      </SettingsGroup>
    </div>
  );
}
