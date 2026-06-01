import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { exportBackup } from "../../backup/exportBackup.ts";
import { downloadBackupFile } from "../../backup/fileDownload.ts";
import { importBackup } from "../../backup/importBackup.ts";
import { validateBackup } from "../../backup/validateBackup.ts";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { resetLocalDataToDefaults } from "../../db/index.ts";
import { useConfirm } from "../../hooks/useConfirm.tsx";
import { getCloudSyncEnabled } from "../../lib/cloudSyncSetting.ts";
import { getMergeOvernightEnabled, setMergeOvernightEnabled } from "../../lib/overnightDisplaySetting.ts";
import { safeGetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { formatAppDateTime, getDateString } from "../../lib/time.ts";
import { deleteQuickNotesByRange } from "../../quick-notes/deleteQuickNotesRange.ts";
import { exportQuickNotesJsonByRange, exportQuickNotesMarkdownByRange } from "../../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../../quick-notes/fileDownload.ts";
import { importQuickNotes } from "../../quick-notes/importQuickNotes.ts";
import SettingsDetailPage from "./SettingsDetailPage.js";

export default function SettingsDataPage() {
  const {
    syncing,
    error,
    forceReplace,
    refreshSyncStatus,
    healthReport,
    healthLoading,
    forcePushPreparation,
    syncFailureCount,
    needsSyncDiagnostics,
    runDiagnostics,
    prepareForcePushToServer,
    forcePushToServer,
    conflicts,
    handleConflictResolution,
    setCloudSyncEnabledInContext,
  } = useSyncContext();
  const { confirm, dialog } = useConfirm();
  const location = useLocation();
  const initialDataStatus =
    typeof location.state === "object" && location.state && "dataStatus" in location.state
      ? String(location.state.dataStatus)
      : "";
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(getCloudSyncEnabled());
  const [mergeOvernightEnabled, setMergeOvernightEnabledState] = useState(getMergeOvernightEnabled());
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState(initialDataStatus);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [forcePushPhrase, setForcePushPhrase] = useState("");
  const [forcePushConfirmation, setForcePushConfirmation] = useState(false);
  const today = getDateString(new Date());
  const [quickNotesFromDate, setQuickNotesFromDate] = useState(today);
  const [quickNotesToDate, setQuickNotesToDate] = useState(today);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const quickNotesImportInputRef = useRef<HTMLInputElement>(null);
  const apiUrl = safeGetItem(STORAGE_KEYS.apiUrl) || "";

  useEffect(() => {
    if (needsSyncDiagnostics) setRecoveryOpen(true);
  }, [needsSyncDiagnostics]);

  function handleCloudSyncChange(e: ChangeEvent<HTMLInputElement>) {
    const enabled = e.target.checked;
    setCloudSyncEnabledInContext(enabled);
    setCloudSyncEnabledState(enabled);
  }

  function handleMergeOvernightChange(e: ChangeEvent<HTMLInputElement>) {
    const enabled = e.target.checked;
    setMergeOvernightEnabled(enabled);
    setMergeOvernightEnabledState(enabled);
  }

  async function handleForceReplace() {
    if (!cloudSyncEnabled) return;
    const confirmed = await confirm({
      title: "确认替换本地数据",
      body: "此操作会清空本地所有记录，从服务器重新拉取全部数据。同步前会自动备份当前本地数据。",
      danger: true,
    });
    if (!confirmed) return;

    const count = await forceReplace();
    if (count !== null) {
      setDataStatus(`已从云端拉取 ${count} 条数据，本地数据已完全替换。`);
    }
  }

  async function handleRunDiagnostics() {
    const report = await runDiagnostics();
    if (report) {
      setDataStatus(report.reason);
    }
  }

  async function handlePrepareForcePush() {
    if (!cloudSyncEnabled) return;
    const confirmed = await confirm({
      title: "准备覆盖云端",
      body: "此操作不会立刻写入服务器，但下一步确认后会清空服务器当前数据并导入本地数据。服务器会先创建备份。",
      danger: true,
    });
    if (!confirmed) return;

    const preparation = await prepareForcePushToServer();
    if (preparation) {
      setForcePushPhrase("");
      setForcePushConfirmation(false);
      setDataStatus(
        `请在下方输入 ${preparation.confirmationPhrase} 后执行覆盖。确认令牌将在 ${formatAppDateTime(preparation.expiresAt)} 过期。`,
      );
    }
  }

  async function handleForcePushToServer() {
    if (!forcePushPreparation) return;
    if (forcePushPhrase !== forcePushPreparation.confirmationPhrase) {
      setDataStatus("确认短语不匹配，未执行覆盖。");
      return;
    }
    if (!forcePushConfirmation) {
      setDataStatus("请先勾选最终确认复选框。");
      return;
    }

    const confirmed = await confirm({
      title: "最后确认：覆盖云端",
      body: "将用当前设备的本地分类和时间记录完全覆盖服务器。服务器当前数据会先备份，但此操作仍会影响所有设备后续同步。",
      danger: true,
    });
    if (!confirmed) return;

    const result = await forcePushToServer(forcePushPreparation.confirmToken, "OVERWRITE_SERVER");
    if (result) {
      setForcePushPhrase("");
      setForcePushConfirmation(false);
      setDataStatus(
        `已覆盖服务器：${result.importedCategories} 个分类，${result.importedTimeEntries} 条记录，${result.importedQuickNotes} 条速记。服务器备份：${result.backupId}。`,
      );
    }
  }

  async function handleFullBackupExport() {
    setDataBusy(true);
    setDataStatus("");
    try {
      const backup = await exportBackup();
      await downloadBackupFile(backup);
      setDataStatus(`完整备份已生成：${backup.categories.length} 个分类，${backup.timeEntries.length} 条记录。`);
    } catch (e: unknown) {
      setDataStatus(`完整备份导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
    }
  }

  async function handleRestoreFile(file: File) {
    setDataBusy(true);
    setDataStatus("");
    try {
      const parsed = JSON.parse(await file.text());
      const validation = validateBackup(parsed);
      if (!validation.ok) {
        setDataStatus(`备份文件无效：${validation.error.message}`);
        return;
      }

      const { summary } = validation;
      const confirmed = await confirm({
        title: "确认恢复完整备份",
        body: (
          <>
            <p>导出时间：{formatAppDateTime(summary.exportedAt)}</p>
            <p>
              分类数量：{summary.categoryCount}，记录数量：{summary.entryCount}
            </p>
            <p>恢复会替换当前设备上的本地分类、时间记录和同步队列。恢复前会先下载一份当前本地数据的安全备份。</p>
          </>
        ),
        danger: true,
      });
      if (!confirmed) return;

      const beforeRestore = await exportBackup();
      await downloadBackupFile(beforeRestore, "TimeData-before-restore");
      const result = await importBackup(validation.backup);
      await refreshSyncStatus();
      setDataStatus(
        `已恢复完整备份：${result.categoryCount} 个分类，${result.entryCount} 条记录。服务器数据可能不同步，请确认后再手动同步。`,
      );
    } catch (e: unknown) {
      setDataStatus(`恢复失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  }

  function handleRestoreInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleRestoreFile(file);
  }

  async function handleQuickNotesImportFile(file: File) {
    setDataBusy(true);
    setDataStatus("");
    try {
      const result = await importQuickNotes(JSON.parse(await file.text()));
      setDataStatus(`已导入速记：新增 ${result.inserted} 条，更新 ${result.updated} 条，保留 ${result.kept} 条。`);
    } catch (e: unknown) {
      setDataStatus(`速记导入失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
      if (quickNotesImportInputRef.current) quickNotesImportInputRef.current.value = "";
    }
  }

  function handleQuickNotesImportInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleQuickNotesImportFile(file);
  }

  function quickNotesRangeLabel(): string {
    return quickNotesFromDate === quickNotesToDate ? quickNotesFromDate : `${quickNotesFromDate}_to_${quickNotesToDate}`;
  }

  async function handleQuickNotesExportJson() {
    setDataBusy(true);
    setDataStatus("");
    try {
      const backup = await exportQuickNotesJsonByRange(quickNotesFromDate, quickNotesToDate);
      await downloadQuickNotesJson(backup);
      setDataStatus(`速记 JSON 已导出：${backup.notes.length} 条。`);
    } catch (e: unknown) {
      setDataStatus(`速记导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
    }
  }

  async function handleQuickNotesExportMarkdown() {
    setDataBusy(true);
    setDataStatus("");
    try {
      const markdown = await exportQuickNotesMarkdownByRange(quickNotesFromDate, quickNotesToDate);
      await downloadQuickNotesMarkdown(markdown, quickNotesRangeLabel());
      setDataStatus("速记 Markdown 已导出。");
    } catch (e: unknown) {
      setDataStatus(`速记导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
    }
  }

  async function handleQuickNotesDeleteRange() {
    const confirmed = await confirm({
      title: "确认删除速记",
      body: `${quickNotesFromDate} 至 ${quickNotesToDate} 的速记会被删除，不影响时间分类和时间段记录。建议先导出需要保留的内容。`,
      confirmLabel: "删除速记",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    setDataBusy(true);
    setDataStatus("");
    try {
      const result = await deleteQuickNotesByRange(quickNotesFromDate, quickNotesToDate);
      setDataStatus(`已删除 ${result.deleted} 条速记。`);
    } catch (e: unknown) {
      setDataStatus(`速记删除失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
    }
  }

  async function handleResetLocalData() {
    if (
      !(await confirm({
        title: "确认清空本地数据",
        body: "清空本地时间记录、同步队列，并把分类恢复为默认预设。",
        danger: true,
      }))
    )
      return;

    setDataBusy(true);
    setDataStatus("");
    try {
      await resetLocalDataToDefaults();
      await refreshSyncStatus();
      setDataStatus("本地数据已清空，分类已恢复为默认预设。");
    } catch (e: unknown) {
      setDataStatus(`本地清空失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setDataBusy(false);
    }
  }

  const remoteDeleteConflicts = conflicts.filter((conflict) => conflict.remoteAction === "delete");

  return (
    <SettingsDetailPage title="数据设置">
      {dialog}
      {remoteDeleteConflicts.length > 0 && (
        <section className="space-y-3 rounded-xl border border-amber-800 bg-amber-950/30 p-4">
          <h3 className="text-sm font-medium text-amber-100">服务器上这条记录已被删除</h3>
          <div className="text-xs text-amber-100/80">本地仍保留了一些未同步的修改。</div>
          <div className="text-xs text-slate-400">受影响：{remoteDeleteConflicts.length} 条冲突。</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleConflictResolution("keep_local")}
              className="rounded bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600"
            >
              保留本地（重新创建到服务器）
            </button>
            <button
              type="button"
              onClick={() => void handleConflictResolution("use_remote")}
              className="rounded bg-red-950 px-4 py-2 text-sm text-red-100 hover:bg-red-900"
            >
              接受删除（丢弃本地修改）
            </button>
          </div>
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-slate-100">是否开启云同步</span>
            <span className="mt-1 block text-xs text-slate-500">关闭后不会自动同步，也不会强制替换云端数据。</span>
          </span>
          <input type="checkbox" checked={cloudSyncEnabled} onChange={handleCloudSyncChange} className="h-5 w-5" />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-slate-100">跨天记录合并展示</span>
            <span className="mt-1 block text-xs text-slate-500">
              开启后，结束于当天的跨天记录会显示完整时间段，例如 23:57 - 06:00。统计仍按自然日计算。
            </span>
          </span>
          <input
            type="checkbox"
            checked={mergeOvernightEnabled}
            onChange={handleMergeOvernightChange}
            className="h-5 w-5"
          />
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-medium text-slate-400">备份与数据</h3>
        <div className="space-y-3">
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleFullBackupExport}
              disabled={dataBusy}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              导出完整备份
            </button>
          </div>

          <div className="space-y-2">
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleRestoreInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={dataBusy}
              className="rounded bg-amber-700 px-4 py-2 text-sm text-amber-50 hover:bg-amber-600 disabled:opacity-40"
            >
              从完整备份恢复
            </button>
            <div className="text-xs text-slate-500">恢复会替换本地核心数据，并在恢复前下载当前本地数据的安全备份。</div>
          </div>

          <div className="space-y-2">
            <Link
              to="/settings/data/backup-history"
              className="inline-flex rounded bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600"
            >
              查看本地备份记录
            </Link>
            <div className="text-xs text-slate-500">
              这里只展示同步、恢复等操作前创建的本地安全备份，不是云同步日志。
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-medium text-slate-400">速记数据</h3>
        <div className="text-xs text-slate-500">只处理速记，不影响时间记录。</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-slate-400">
            开始日期
            <input
              type="date"
              value={quickNotesFromDate}
              onChange={(e) => setQuickNotesFromDate(e.target.value)}
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="space-y-1 text-xs text-slate-400">
            结束日期
            <input
              type="date"
              value={quickNotesToDate}
              onChange={(e) => setQuickNotesToDate(e.target.value)}
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleQuickNotesExportJson()}
            disabled={dataBusy}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            导出速记 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleQuickNotesExportMarkdown()}
            disabled={dataBusy}
            className="rounded bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-40"
          >
            导出速记 Markdown
          </button>
          <input
            ref={quickNotesImportInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleQuickNotesImportInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => quickNotesImportInputRef.current?.click()}
            disabled={dataBusy}
            className="rounded bg-amber-700 px-4 py-2 text-sm text-amber-50 hover:bg-amber-600 disabled:opacity-40"
          >
            导入速记 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleQuickNotesDeleteRange()}
            disabled={dataBusy}
            className="rounded bg-red-950 px-4 py-2 text-sm text-red-100 hover:bg-red-900 disabled:opacity-40"
          >
            删除日期范围速记
          </button>
        </div>
        <div className="text-xs text-slate-500">删除前请先导出需要保留的内容。</div>
      </section>

      <details
        open={recoveryOpen}
        onToggle={(e) => setRecoveryOpen(e.currentTarget.open)}
        className="rounded-xl border border-slate-800 bg-slate-900/60"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300">
          高级 · 数据恢复
          <span className="ml-2 text-xs text-slate-500">同步诊断、强制替换、覆盖云端、重置</span>
        </summary>
        <div className="space-y-5 p-4 pt-0">
          {needsSyncDiagnostics && (
            <div className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-100">
              普通同步已连续失败 {syncFailureCount} 次。建议先运行诊断，再决定使用云端覆盖本地或本地覆盖云端。
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-400">同步健康诊断</h3>
            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={healthLoading || !apiUrl || !cloudSyncEnabled}
              className="rounded bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-40"
            >
              {healthLoading ? "诊断中…" : "检查本地与云端状态"}
            </button>
            {healthReport && (
              <div className="space-y-1 text-xs text-slate-400">
                <div>
                  本地：{healthReport.local.categoryCount} 个分类，{healthReport.local.entryCount} 条记录，未同步{" "}
                  {healthReport.local.unsyncedCount} 条，速记 {healthReport.local.quickNoteCount} 条。
                </div>
                <div>
                  云端：{healthReport.server.categoryCount} 个分类，{healthReport.server.entryCount} 条记录，
                  {healthReport.server.quickNoteCount} 条速记。
                </div>
                <div className="text-slate-300">建议：{healthReport.reason}</div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-400">强制替换</h3>
            <button
              type="button"
              onClick={handleForceReplace}
              disabled={syncing || !apiUrl || !cloudSyncEnabled}
              className="rounded bg-red-950 px-4 py-2 text-sm text-red-100 hover:bg-red-900 disabled:opacity-40"
            >
              {syncing ? "同步中…" : "将本地数据替换为云端数据"}
            </button>
            <div className="text-xs text-slate-500">此操作会先自动备份本地数据，再用云端完整数据覆盖本地。</div>
          </section>

          <section className="space-y-3 rounded border border-red-950 bg-red-950/20 p-3">
            <h3 className="text-sm font-medium text-red-200">将本地数据覆盖到云端</h3>
            <div className="text-xs text-red-100/80">
              仅当你已经确认当前设备数据是正确版本时使用。此操作会先在服务器创建备份，然后清空服务器分类和时间记录并导入本地数据。
            </div>
            <button
              type="button"
              onClick={handlePrepareForcePush}
              disabled={syncing || !apiUrl || !cloudSyncEnabled}
              className="rounded bg-red-800 px-4 py-2 text-sm text-red-50 hover:bg-red-700 disabled:opacity-40"
            >
              准备覆盖云端
            </button>
            {forcePushPreparation && (
              <div className="space-y-2 rounded border border-red-900 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">
                  云端当前：{forcePushPreparation.serverStatus.categoryCount} 个分类，
                  {forcePushPreparation.serverStatus.entryCount} 条记录，
                  {forcePushPreparation.serverStatus.quickNoteCount} 条速记。令牌过期时间：
                  {formatAppDateTime(forcePushPreparation.expiresAt)}。
                </div>
                <label className="block text-xs text-slate-300">
                  输入确认短语：{forcePushPreparation.confirmationPhrase}
                  <input
                    type="text"
                    value={forcePushPhrase}
                    onChange={(e) => setForcePushPhrase(e.target.value)}
                    className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={forcePushConfirmation}
                    onChange={(e) => setForcePushConfirmation(e.target.checked)}
                    className="h-4 w-4"
                  />
                  我已确认当前设备数据是正确版本
                </label>
                <button
                  type="button"
                  onClick={handleForcePushToServer}
                  disabled={
                    syncing || forcePushPhrase !== forcePushPreparation.confirmationPhrase || !forcePushConfirmation
                  }
                  className="rounded bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-40"
                >
                  确认用本地覆盖云端
                </button>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-400">数据重置</h3>
            <button
              type="button"
              onClick={handleResetLocalData}
              disabled={dataBusy}
              className="rounded bg-red-950 px-4 py-2 text-sm text-red-100 hover:bg-red-900 disabled:opacity-40"
            >
              清空本地并恢复预设
            </button>
          </section>
        </div>
      </details>

      {error && <div className="text-xs text-red-400">{error}</div>}
      {dataStatus && <div className="text-xs text-slate-400">{dataStatus}</div>}
    </SettingsDetailPage>
  );
}
