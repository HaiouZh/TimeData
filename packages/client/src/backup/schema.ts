import type { Category, TimeEntry } from "@timedata/shared";

export const BACKUP_FORMAT = "timedata.backup" as const;

export interface BackupDeviceInfo {
  deviceId: string | null;
  deviceName: string | null;
}

export interface BackupDocument {
  format: typeof BACKUP_FORMAT;
  timeFormat: "utc";
  exportedAt: string;
  appVersion: string;
  device: BackupDeviceInfo;
  /** 核心业务表：分类（命名顶层，带两级树校验）。 */
  categories: Category[];
  /** 核心业务表：时间段记录（命名顶层，带分类外键校验）。 */
  timeEntries: TimeEntry[];
  /**
   * 其余普通状态域（任务 / 速记 / 健康数据等），按 table 名（snake_case）键入。
   * 域集合由客户端域登记簿 `BACKUP_BUNDLED_DOMAINS` 派生——新增普通域只要登记 `backup:"bundled"` 即自动进备份。
   */
  domains: Record<string, unknown[]>;
}

export interface BackupSummary {
  exportedAt: string;
  categoryCount: number;
  entryCount: number;
  /** 各普通域记录数，按 table 名键入（如 `tasks`、`quick_notes`、`health_sleep`）。 */
  domainCounts: Record<string, number>;
}

export type BackupValidationErrorCode =
  | "NOT_OBJECT"
  | "INVALID_FORMAT"
  | "INVALID_EXPORTED_AT"
  | "INVALID_APP_VERSION"
  | "INVALID_DEVICE"
  | "INVALID_CATEGORIES"
  | "INVALID_TIME_ENTRIES"
  | "INVALID_DOMAINS"
  | "INVALID_DOMAIN_RECORDS"
  | "INVALID_TIME_FORMAT"
  | "INVALID_TIME_ENTRY_TIME"
  | "INVALID_CATEGORY_TREE"
  | "DUPLICATE_CATEGORY_ID"
  | "DUPLICATE_ENTRY_ID"
  | "DUPLICATE_DOMAIN_ID"
  | "ORPHAN_CATEGORY_PARENT"
  | "ORPHAN_ENTRY_CATEGORY";

export interface BackupValidationError {
  code: BackupValidationErrorCode;
  message: string;
}

export type BackupValidationResult =
  | { ok: true; backup: BackupDocument; summary: BackupSummary }
  | { ok: false; error: BackupValidationError };
