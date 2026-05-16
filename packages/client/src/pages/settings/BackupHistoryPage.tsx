import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AutoBackupRecord } from "../../db/index.js";
import { exportBackup } from "../../backup/exportBackup.js";
import { downloadBackupFile } from "../../backup/fileDownload.js";
import { importBackup } from "../../backup/importBackup.js";
import { listAutoBackups } from "../../backup/autoBackup.js";
import { useConfirm } from "../../hooks/useConfirm.tsx";
import { formatAppDateTime } from "../../lib/time.js";
import SettingsDetailPage from "./SettingsDetailPage.js";

interface BackupHistoryPageProps {
  initialRecords?: AutoBackupRecord[];
}

export default function BackupHistoryPage({ initialRecords }: BackupHistoryPageProps = {}) {
  const [records, setRecords] = useState<AutoBackupRecord[]>(initialRecords ?? []);
  const [loading, setLoading] = useState(!initialRecords);
  const [status, setStatus] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus("");
      try {
        const backups = await listAutoBackups();
        if (!cancelled) setRecords(backups);
      } catch (e: unknown) {
        if (!cancelled) setStatus(`读取备份记录失败：${e instanceof Error ? e.message : "未知错误"}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function restoreRecord(record: AutoBackupRecord) {
    const summary = `${record.categories.length} 个分类，${record.timeEntries.length} 条记录`;
    const shouldBackupFirst = await confirm({
      title: "确认恢复自动备份",
      body: (
        <>
          <p>备份时间：{formatAppDateTime(record.createdAt)}</p>
          <p>数据内容：{summary}</p>
          <p>恢复会替换当前设备上的本地分类、时间记录和同步队列。确认后会先下载当前数据的安全备份，再执行恢复。</p>
        </>
      ),
      danger: true,
    });
    if (!shouldBackupFirst) return;

    setRestoringId(record.id);
    setStatus("");
    try {
      const beforeRestore = await exportBackup();
      downloadBackupFile(beforeRestore, "TimeData-before-auto-backup-restore");
      const result = await importBackup({
        format: "timedata.backup.v1",
        exportedAt: record.createdAt,
        categories: record.categories,
        timeEntries: record.timeEntries,
      });
      navigate("/settings/data", {
        replace: true,
        state: { dataStatus: `已恢复自动备份：${result.categoryCount} 个分类，${result.entryCount} 条记录。服务器数据可能不同步，请确认后再手动同步。` },
      });
    } catch (e: unknown) {
      setStatus(`恢复失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <SettingsDetailPage title="备份记录">
      {dialog}
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-medium text-slate-400">自动备份</h3>
        {loading && <div className="text-sm text-slate-400">正在读取自动备份记录…</div>}
        {!loading && records.length === 0 && <div className="text-sm text-slate-500">暂无自动备份记录</div>}
        {!loading && records.length > 0 && (
          <div className="space-y-2">
            {records.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-slate-700 hover:bg-slate-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-100">{formatAppDateTime(record.createdAt)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {record.categories.length} 个分类，{record.timeEntries.length} 条记录
                  </div>
                  {restoringId === record.id && <div className="mt-2 text-xs text-blue-300">正在恢复…</div>}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  onClick={() => void restoreRecord(record)}
                  disabled={restoringId !== null}
                >
                  {restoringId === record.id ? "恢复中…" : "恢复"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {status && <div className="text-xs text-red-400">{status}</div>}
    </SettingsDetailPage>
  );
}
