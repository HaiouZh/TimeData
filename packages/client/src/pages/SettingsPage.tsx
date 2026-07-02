import type { VersionInfo } from "@timedata/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppUpdate } from "../appUpdate.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { type AndroidApkUpdate, fetchAndroidApkUpdate, openAndroidApkUpdate } from "../lib/mobileUpdate.ts";
import { fetchServerVersion, pollServerUpdate, triggerServerUpdate } from "../lib/serverVersion.ts";
import type { SyncStreamState } from "../lib/syncStream.js";
import { formatAppDateTime } from "../lib/time.ts";
import type { RegularSyncResult } from "../sync/engine.ts";
import {
  ArrowsClockwise,
  CaretRight,
  Cards,
  ChartBar,
  Cloud,
  Database,
  DeviceMobile,
  HardDrives,
  Moon,
  Signpost,
  Tag,
} from "@phosphor-icons/react";
import { Icon } from "../components/Icon.js";
import SyncTimingsPanel from "../components/SyncTimingsPanel.js";
import { SettingsRow, SettingsSection } from "./settings/components/SettingsRows.js";

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
  if (color === "green") return "bg-ok";
  if (color === "yellow") return "bg-warn";
  if (color === "red") return "bg-danger";
  return "bg-ink-3";
}

function ConnectionLight({ color }: { color: ServerConnectionColor }) {
  const dot = statusDotClass(color);
  return (
    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
      <span className={`absolute h-2.5 w-2.5 rounded-full opacity-50 blur-[3px] ${dot}`} />
      <span className={`relative h-2 w-2 rounded-full ${dot}`} />
    </span>
  );
}

function SyncIssueList({ issues }: { issues: NonNullable<RegularSyncResult["pushIssues"]> }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-1 rounded-ctl border border-warn/50 bg-warn-soft p-2 text-warn">
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
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <Link to="/settings/server" className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-hover">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-surface-elevated text-ink-2">
          <Icon icon={Cloud} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-ink">服务器配置</span>
            <ConnectionLight color={connectionState.color} />
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-3">{connectionState.subtitle}</div>
        </div>
        <Icon icon={CaretRight} size={20} className="text-ink-3" />
      </Link>

      {cloudSyncEnabled && (
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-ink">同步信息</h3>
            <button
              type="button"
              onClick={() => sync()}
              disabled={syncing}
              className="shrink-0 rounded-ctl bg-accent px-3 py-1.5 text-xs font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
            >
              {syncing ? "同步中…" : "同步"}
            </button>
          </div>
          <div className="mt-2 space-y-1 text-xs text-ink-2">
            <p>上次同步: {lastSynced ? formatAppDateTime(lastSynced) : "从未"}</p>
            <p>待同步: {unsyncedCount} 条</p>
            {lastResult?.identical && <p className="text-ok">本地与云端数据一致，无需同步。</p>}
            {lastResult && !lastResult.identical && !conflicts.length && (
              <p className="text-ok">
                已推送 {lastResult.pushed} 条，已拉取 {lastResult.pulled} 条
              </p>
            )}
            {lastResult && lastResult.rejected > 0 && <p className="text-danger">云端拒绝 {lastResult.rejected} 条</p>}
            {lastResult && lastResult.pushConflicts > 0 && (
              <p className="text-warn">云端冲突 {lastResult.pushConflicts} 条</p>
            )}
            {lastResult?.pushIssues && <SyncIssueList issues={lastResult.pushIssues} />}
            {conflicts.length > 0 && (
              <p className="text-warn">发现 {conflicts.length} 条冲突，请到数据设置处理。</p>
            )}
            {error && <p className="text-danger">{error}</p>}
            <SyncTimingsPanel />
          </div>
        </div>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { apiUrl, connection } = useSyncContext();
  const { currentBuildId, forceRefresh } = useAppUpdate();
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

  async function handleServerUpdate() {
    if (!apiUrl) return;

    setServerUpdateStatus("正在检查更新…");
    const latestServerVersion = await fetchServerVersion({ force: true });
    setServerVersion(latestServerVersion);

    if (!latestServerVersion.ok) {
      setServerUpdateStatus(`检查失败：${latestServerVersion.error}`);
      return;
    }

    const version = latestServerVersion.version;

    if (!version.checkOk) {
      setServerUpdateStatus("检查失败：无法从 GitHub 获取最新版本（网络或限流），请稍后重试。");
      return;
    }

    if (!version.hasUpdate) {
      setServerUpdateStatus(`服务端已是最新版本（${version.current}）。`);
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
    const triggered = await triggerServerUpdate();

    if (!triggered.ok && triggered.reason === "error") {
      setServerUpdating(false);
      setServerUpdateStatus(`触发失败：${triggered.message}`);
      return;
    }
    if (!triggered.ok) {
      setServerUpdateStatus(`更新已在进行中（${triggered.updateId ?? "未知任务"}），正在等待完成…`);
    } else {
      setServerUpdateStatus(`更新中…（${triggered.updateId}）`);
    }

    const outcome = await pollServerUpdate({
      fromSha: version.current,
      onProgress: (text) => setServerUpdateStatus(text),
    });

    if (outcome.kind === "succeeded") {
      setServerUpdateStatus(`已更新到 ${outcome.version} ✅`);
    } else if (outcome.kind === "failed") {
      setServerUpdateStatus(`更新失败：${outcome.message}`);
    } else {
      setServerUpdateStatus("更新已发起，但等待超时；服务端可能仍在更新，请稍后手动刷新版本。");
    }
    setServerUpdating(false);
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 bg-page p-4 pb-10 text-ink">
      {dialog}
      <header className="px-1 pt-1">
        <h2 className="text-2xl font-semibold text-ink">设置</h2>
      </header>

      {/* 状态总览：服务器连接 + 同步摘要合并为一张卡（顺序：服务器配置 → 同步信息） */}
      <ServerStatusCard />

      <SettingsSection title="连接与同步">
        <SettingsRow
          to="/settings/garmin"
          icon={<Icon icon={ArrowsClockwise} size={20} />}
          title="Garmin 数据同步"
          subtitle="配置 Garmin 账号、定时抓取健康数据"
        />
      </SettingsSection>

      <SettingsSection title="记录偏好">
        <SettingsRow
          to="/settings/categories"
          icon={<Icon icon={Tag} size={20} />}
          title="分类管理"
          subtitle="新增、排序、改色、子分类与删除"
        />
        <SettingsRow
          to="/settings/insights"
          icon={<Icon icon={Moon} size={20} />}
          title="记录偏好"
          subtitle="待办默认落点、打点分类、睡眠分类"
        />
        <SettingsRow
          to="/settings/tracks"
          icon={<Icon icon={Signpost} size={20} />}
          title="轨道看板信号"
          subtitle="配置进入轨道列表聚合的步骤标签"
        />
        <SettingsRow
          to="/settings/todo-gravity"
          icon={<Icon icon={Cards} size={20} />}
          title="水位线与翻牌"
          subtitle="调整收件箱沉下去的节奏和翻牌数量"
        />
      </SettingsSection>

      <SettingsSection title="统计与健康">
        <SettingsRow
          to="/settings/stats-layout"
          icon={<Icon icon={ChartBar} size={20} />}
          title="统计页面布局"
          subtitle="调整统计模块显示与顺序"
        />
        <SettingsRow
          to="/settings/health-range"
          icon={<Icon icon={ChartBar} size={20} />}
          title="健康范围"
          subtitle="选择健康统计页显示的时间范围"
        />
      </SettingsSection>

      <SettingsSection title="导航与界面">
        <SettingsRow
          to="/settings/nav"
          icon={<Icon icon={DeviceMobile} size={20} />}
          title="导航"
          subtitle="配置移动底栏与桌面侧栏"
        />
      </SettingsSection>

      <SettingsSection title="高级与更新">
        <SettingsRow
          to="/settings/data"
          icon={<Icon icon={Database} size={20} />}
          title="数据设置"
          subtitle="云同步、显示、备份与高级数据恢复"
        />
        <SettingsRow
          to="/settings/admin-insights"
          icon={<Icon icon={HardDrives} size={20} />}
          title="服务端数据洞察"
          subtitle="只读查看服务器数据、同步、备份、健康检查和请求审计"
        />
        <SettingsRow
          icon={<Icon icon={DeviceMobile} size={20} />}
          tone="accent"
          title="APK 更新"
          subtitle={apkStatus || `当前版本：${__TIMEDATA_ANDROID_VERSION_CODE__}`}
          accessory={apkUpdate?.hasUpdate ? apkUpdate.versionCode : undefined}
          disabled={apkChecking}
          onClick={handleCheckApkUpdate}
        />
        <SettingsRow
          icon={<Icon icon={ArrowsClockwise} size={20} />}
          tone="accent"
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
        <SettingsRow
          icon={<Icon icon={ArrowsClockwise} size={20} />}
          tone="accent"
          title="刷新到最新前端"
          subtitle={`当前前端版本：${currentBuildId}`}
          onClick={forceRefresh}
        />
      </SettingsSection>
    </div>
  );
}
