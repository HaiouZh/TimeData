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
  categories: Category[];
  timeEntries: TimeEntry[];
}

export interface BackupSummary {
  exportedAt: string;
  categoryCount: number;
  entryCount: number;
}

export type BackupValidationErrorCode =
  | "NOT_OBJECT"
  | "INVALID_FORMAT"
  | "INVALID_EXPORTED_AT"
  | "INVALID_APP_VERSION"
  | "INVALID_DEVICE"
  | "INVALID_CATEGORIES"
  | "INVALID_TIME_ENTRIES"
  | "INVALID_TIME_FORMAT"
  | "INVALID_TIME_ENTRY_TIME"
  | "INVALID_CATEGORY_TREE"
  | "DUPLICATE_CATEGORY_ID"
  | "DUPLICATE_ENTRY_ID"
  | "ORPHAN_CATEGORY_PARENT"
  | "ORPHAN_ENTRY_CATEGORY";

export interface BackupValidationError {
  code: BackupValidationErrorCode;
  message: string;
}

export type BackupValidationResult =
  | { ok: true; backup: BackupDocument; summary: BackupSummary }
  | { ok: false; error: BackupValidationError };
