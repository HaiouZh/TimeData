import { BACKUP_FORMAT_V1, BACKUP_FORMAT_V2, type BackupDocumentV2, type BackupValidationResult } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasCategoryShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && isString(value.name)
    && isNullableString(value.parentId)
    && isString(value.color)
    && (value.icon === null || isString(value.icon))
    && typeof value.sortOrder === "number"
    && typeof value.isArchived === "boolean"
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

function hasEntryShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && isString(value.categoryId)
    && isString(value.startTime)
    && isString(value.endTime)
    && (value.note === null || isString(value.note))
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

export function validateBackup(value: unknown): BackupValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: { code: "NOT_OBJECT", message: "备份文件不是有效的 JSON 对象。" } };
  }

  if (value.format === BACKUP_FORMAT_V1) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: "此备份使用旧版本格式（v1），与当前版本不兼容。请使用新版本应用重新导出备份。",
      },
    };
  }
  if (value.format !== BACKUP_FORMAT_V2) {
    return { ok: false, error: { code: "INVALID_FORMAT", message: "备份文件格式不支持。" } };
  }

  if (!isString(value.exportedAt)) {
    return { ok: false, error: { code: "INVALID_EXPORTED_AT", message: "备份文件缺少有效导出时间。" } };
  }

  if (!isString(value.appVersion)) {
    return { ok: false, error: { code: "INVALID_APP_VERSION", message: "备份文件缺少有效应用版本。" } };
  }

  if (!isRecord(value.device) || !isNullableString(value.device.deviceId) || !isNullableString(value.device.deviceName)) {
    return { ok: false, error: { code: "INVALID_DEVICE", message: "备份文件设备信息无效。" } };
  }

  if (!Array.isArray(value.categories) || !value.categories.every(hasCategoryShape)) {
    return { ok: false, error: { code: "INVALID_CATEGORIES", message: "备份文件分类数据无效。" } };
  }

  if (!Array.isArray(value.timeEntries) || !value.timeEntries.every(hasEntryShape)) {
    return { ok: false, error: { code: "INVALID_TIME_ENTRIES", message: "备份文件记录数据无效。" } };
  }

  const categoryIds = new Set<string>();
  for (const category of value.categories) {
    const id = category.id as string;
    if (categoryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_CATEGORY_ID", message: `备份文件中存在重复分类 ID：${id}。` } };
    }
    categoryIds.add(id);
  }

  const entryIds = new Set<string>();
  for (const entry of value.timeEntries) {
    const id = entry.id as string;
    if (entryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_ENTRY_ID", message: `备份文件中存在重复记录 ID：${id}。` } };
    }
    entryIds.add(id);
  }

  for (const category of value.categories) {
    const parentId = category.parentId as string | null;
    if (parentId && !categoryIds.has(parentId)) {
      return { ok: false, error: { code: "ORPHAN_CATEGORY_PARENT", message: `分类 ${category.id as string} 引用了不存在的父分类 ${parentId}。` } };
    }
  }

  for (const entry of value.timeEntries) {
    const categoryId = entry.categoryId as string;
    if (!categoryIds.has(categoryId)) {
      return { ok: false, error: { code: "ORPHAN_ENTRY_CATEGORY", message: `记录 ${entry.id as string} 引用了不存在的分类 ${categoryId}。` } };
    }
  }

  const backup = value as unknown as BackupDocumentV2;
  return {
    ok: true,
    backup,
    summary: {
      exportedAt: backup.exportedAt,
      categoryCount: backup.categories.length,
      entryCount: backup.timeEntries.length,
    },
  };
}
