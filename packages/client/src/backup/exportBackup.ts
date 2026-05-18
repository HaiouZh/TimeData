import { db } from "../db/index.js";
import { BACKUP_FORMAT, type BackupDeviceInfo, type BackupDocument } from "./schema.js";

export interface ExportBackupOptions {
  now?: () => string;
  appVersion?: string;
  device?: Partial<BackupDeviceInfo>;
}

function defaultAppVersion(): string {
  return (import.meta as ImportMeta & { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION || "0.1.0";
}

export async function exportBackup(options: ExportBackupOptions = {}): Promise<BackupDocument> {
  const [categories, timeEntries] = await Promise.all([db.categories.toArray(), db.timeEntries.toArray()]);

  return {
    format: BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt: options.now ? options.now() : new Date().toISOString(),
    appVersion: options.appVersion || defaultAppVersion(),
    device: {
      deviceId: options.device?.deviceId ?? null,
      deviceName: options.device?.deviceName ?? "Web",
    },
    categories,
    timeEntries,
  };
}
