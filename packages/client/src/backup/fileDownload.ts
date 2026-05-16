import type { BackupDocumentV2 } from "./schema.js";

export type BackupFilePrefix = "TimeData-backup" | "TimeData-before-restore" | "TimeData-before-auto-backup-restore";

export function backupFileName(prefix: BackupFilePrefix, exportedAt: string): string {
  const safeTimestamp = exportedAt.replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
  return `${prefix}-${safeTimestamp}.json`;
}

export function downloadBackupFile(
  backup: BackupDocumentV2,
  prefix: BackupFilePrefix = "TimeData-backup",
): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(prefix, backup.exportedAt);
  a.click();
  URL.revokeObjectURL(url);
}
