import type { Category, TimeEntry } from "@timedata/shared";

export const BACKUP_FORMAT_V1 = "timedata.backup.v1" as const;
export const BACKUP_FORMAT_V2 = "timedata.backup.v2" as const;

export interface BackupDeviceInfo {
  deviceId: string | null;
  deviceName: string | null;
}

export interface BackupDocumentV1 {
  format: typeof BACKUP_FORMAT_V1;
  exportedAt: string;
  appVersion: string;
  device: BackupDeviceInfo;
  categories: Category[];
  timeEntries: TimeEntry[];
}

export interface BackupDocumentV2 {
  format: typeof BACKUP_FORMAT_V2;
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
  | "UNSUPPORTED_FORMAT"
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
  | { ok: true; backup: BackupDocumentV2; summary: BackupSummary }
  | { ok: false; error: BackupValidationError };
