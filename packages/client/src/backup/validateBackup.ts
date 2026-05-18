import { CategorySchema, TimeEntrySchema, UtcIsoStringSchema } from "@timedata/shared";
import { BACKUP_FORMAT, type BackupDocument, type BackupValidationResult } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validateCategoryTree(categories: ReadonlyArray<Record<string, unknown>>): BackupValidationResult | null {
  const byId = new Map(categories.map((category) => [category.id as string, category]));

  for (const category of categories) {
    const id = category.id as string;
    const parentId = category.parentId as string | null;

    if (parentId === id) {
      return { ok: false, error: { code: "INVALID_CATEGORY_TREE", message: `分类 ${id} 不能引用自身。` } };
    }

    if (!parentId) {
      continue;
    }

    const parent = byId.get(parentId);
    if (!parent) {
      return { ok: false, error: { code: "ORPHAN_CATEGORY_PARENT", message: `分类 ${id} 引用了不存在的父分类 ${parentId}。` } };
    }

    if (parent.parentId !== null) {
      return { ok: false, error: { code: "INVALID_CATEGORY_TREE", message: `分类 ${id} 会形成超过两级的分类树。` } };
    }
  }

  return null;
}

export function validateBackup(value: unknown): BackupValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: { code: "NOT_OBJECT", message: "备份文件不是有效的 JSON 对象。" } };
  }

  if (value.format !== BACKUP_FORMAT) {
    return { ok: false, error: { code: "INVALID_FORMAT", message: "备份文件格式不支持。" } };
  }

  if (value.timeFormat !== "utc") {
    return { ok: false, error: { code: "INVALID_TIME_FORMAT", message: "备份文件必须使用 UTC 时间格式。" } };
  }

  if (!UtcIsoStringSchema.safeParse(value.exportedAt).success) {
    return { ok: false, error: { code: "INVALID_EXPORTED_AT", message: "备份文件缺少有效导出时间（必须 UTC .sssZ）。" } };
  }

  if (!isString(value.appVersion)) {
    return { ok: false, error: { code: "INVALID_APP_VERSION", message: "备份文件缺少有效应用版本。" } };
  }

  if (!isRecord(value.device) || !isNullableString(value.device.deviceId) || !isNullableString(value.device.deviceName)) {
    return { ok: false, error: { code: "INVALID_DEVICE", message: "备份文件设备信息无效。" } };
  }

  if (!Array.isArray(value.categories)) {
    return { ok: false, error: { code: "INVALID_CATEGORIES", message: "备份文件分类数据无效。" } };
  }

  for (const raw of value.categories) {
    if (!CategorySchema.safeParse(raw).success) {
      return { ok: false, error: { code: "INVALID_CATEGORIES", message: "备份文件分类数据无效。" } };
    }
  }

  if (!Array.isArray(value.timeEntries)) {
    return { ok: false, error: { code: "INVALID_TIME_ENTRIES", message: "备份文件记录数据无效。" } };
  }

  for (const raw of value.timeEntries) {
    if (!TimeEntrySchema.safeParse(raw).success) {
      return { ok: false, error: { code: "INVALID_TIME_ENTRIES", message: "备份文件记录数据无效。" } };
    }
  }

  const categoryIds = new Set<string>();
  for (const category of value.categories) {
    const id = (category as { id: string }).id;
    if (categoryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_CATEGORY_ID", message: `备份文件中存在重复分类 ID：${id}。` } };
    }
    categoryIds.add(id);
  }

  const entryIds = new Set<string>();
  for (const entry of value.timeEntries) {
    const id = (entry as { id: string }).id;
    if (entryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_ENTRY_ID", message: `备份文件中存在重复记录 ID：${id}。` } };
    }
    entryIds.add(id);
  }

  const treeError = validateCategoryTree(value.categories as Array<Record<string, unknown>>);
  if (treeError) {
    return treeError;
  }

  for (const entry of value.timeEntries) {
    const { id, categoryId } = entry as { id: string; categoryId: string };
    if (!categoryIds.has(categoryId)) {
      return { ok: false, error: { code: "ORPHAN_ENTRY_CATEGORY", message: `记录 ${id} 引用了不存在的分类 ${categoryId}。` } };
    }
  }

  const backup = value as BackupDocument;
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
