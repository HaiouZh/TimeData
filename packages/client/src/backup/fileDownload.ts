import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { BackupDocument } from "./schema.js";

export type BackupFilePrefix = "TimeData-backup" | "TimeData-before-restore" | "TimeData-before-auto-backup-restore";

export function backupFileName(prefix: BackupFilePrefix, exportedAt: string): string {
  const safeTimestamp = exportedAt.replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
  return `${prefix}-${safeTimestamp}.json`;
}

export async function downloadBackupFile(
  backup: BackupDocument,
  prefix: BackupFilePrefix = "TimeData-backup",
): Promise<void> {
  const fileName = backupFileName(prefix, backup.exportedAt);
  const data = JSON.stringify(backup, null, 2);

  if (Capacitor.isNativePlatform()) {
    await saveOnNative(fileName, data);
    return;
  }

  saveInBrowser(fileName, data);
}

function saveInBrowser(fileName: string, data: string): void {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveOnNative(fileName: string, data: string): Promise<void> {
  const writeResult = await Filesystem.writeFile({
    path: fileName,
    data,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (!canShare.value) return;

  try {
    await Share.share({
      title: "TimeData 备份",
      text: fileName,
      url: writeResult.uri,
      dialogTitle: "保存或分享备份",
    });
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return;
    throw error;
  }
}
