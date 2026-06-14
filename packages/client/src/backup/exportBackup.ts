import { db } from "../db/index.js";
import { BACKUP_BUNDLED_DOMAINS } from "../sync/clientDomains.js";
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
  const [categories, timeEntries] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
  ]);

  // 普通域靠登记簿白捡：每个 bundled 域读自己的 Dexie store，按 table 名键入 domains。
  const domains: Record<string, unknown[]> = {};
  await Promise.all(
    BACKUP_BUNDLED_DOMAINS.map(async (domain) => {
      domains[domain.table] = await db.table(domain.storeName).toArray();
    }),
  );

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
    domains,
  };
}
