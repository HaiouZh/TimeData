import {
  CategorySchema,
  TimeEntrySchema,
  UtcIsoStringSchema,
  type Category,
  type TimeEntry,
} from "@timedata/shared";
import { BACKUP_BUNDLED_DOMAINS } from "../sync/clientDomains.js";
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

function validateCategoryTree(categories: ReadonlyArray<Category>): BackupValidationResult | null {
  const byId = new Map(categories.map((category) => [category.id, category]));

  for (const category of categories) {
    const { id, parentId } = category;

    if (parentId === id) {
      return { ok: false, error: { code: "INVALID_CATEGORY_TREE", message: `分类 ${id} 不能引用自身。` } };
    }

    if (!parentId) {
      continue;
    }

    const parent = byId.get(parentId);
    if (!parent) {
      return {
        ok: false,
        error: { code: "ORPHAN_CATEGORY_PARENT", message: `分类 ${id} 引用了不存在的父分类 ${parentId}。` },
      };
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

  const exportedAt = UtcIsoStringSchema.safeParse(value.exportedAt);
  if (!exportedAt.success) {
    return {
      ok: false,
      error: { code: "INVALID_EXPORTED_AT", message: "备份文件缺少有效导出时间（必须 UTC .sssZ）。" },
    };
  }

  if (!isString(value.appVersion)) {
    return { ok: false, error: { code: "INVALID_APP_VERSION", message: "备份文件缺少有效应用版本。" } };
  }

  if (
    !isRecord(value.device) ||
    !isNullableString(value.device.deviceId) ||
    !isNullableString(value.device.deviceName)
  ) {
    return { ok: false, error: { code: "INVALID_DEVICE", message: "备份文件设备信息无效。" } };
  }
  const device = { deviceId: value.device.deviceId, deviceName: value.device.deviceName };

  if (!Array.isArray(value.categories)) {
    return { ok: false, error: { code: "INVALID_CATEGORIES", message: "备份文件分类数据无效。" } };
  }

  const categories: Category[] = [];
  for (const raw of value.categories) {
    const parsed = CategorySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "INVALID_CATEGORIES", message: "备份文件分类数据无效。" } };
    }
    categories.push(parsed.data);
  }

  if (!Array.isArray(value.timeEntries)) {
    return { ok: false, error: { code: "INVALID_TIME_ENTRIES", message: "备份文件记录数据无效。" } };
  }

  const timeEntries: TimeEntry[] = [];
  for (const raw of value.timeEntries) {
    const parsed = TimeEntrySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "INVALID_TIME_ENTRIES", message: "备份文件记录数据无效。" } };
    }
    timeEntries.push(parsed.data);
  }

  // 普通域：`domains` 必须是对象；每个登记的 bundled 域逐条用其 schema 校验、按 id 去重。缺域归一化为空数组。
  if (value.domains !== undefined && !isRecord(value.domains)) {
    return { ok: false, error: { code: "INVALID_DOMAINS", message: "备份文件域数据格式无效。" } };
  }
  const rawDomains = isRecord(value.domains) ? value.domains : {};

  // 只保留备份里“实际存在”的域：缺省的域不进 domains，恢复时原样保留本地该域数据
  // （自动备份只快照核心+任务，恢复它不应抹掉速记/健康）。完整导出始终写齐全部 bundled 域。
  const domains: Record<string, unknown[]> = {};
  const domainCounts: Record<string, number> = {};
  for (const domain of BACKUP_BUNDLED_DOMAINS) {
    const rawList = rawDomains[domain.table];
    if (rawList === undefined) {
      continue;
    }
    if (!Array.isArray(rawList)) {
      return { ok: false, error: { code: "INVALID_DOMAIN_RECORDS", message: `备份文件 ${domain.table} 数据无效。` } };
    }

    const records: unknown[] = [];
    const ids = new Set<string>();
    for (const raw of rawList) {
      const parsed = domain.schema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: "INVALID_DOMAIN_RECORDS", message: `备份文件 ${domain.table} 数据无效。` } };
      }
      const id = domain.keyOf ? domain.keyOf(parsed.data) : (parsed.data as { id?: unknown }).id;
      if (typeof id === "string") {
        if (ids.has(id)) {
          return {
            ok: false,
            error: { code: "DUPLICATE_DOMAIN_ID", message: `备份文件中 ${domain.table} 存在重复 ID：${id}。` },
          };
        }
        ids.add(id);
      }
      records.push(parsed.data);
    }
    domains[domain.table] = records;
    domainCounts[domain.table] = records.length;
  }

  const categoryIds = new Set<string>();
  for (const category of categories) {
    const { id } = category;
    if (categoryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_CATEGORY_ID", message: `备份文件中存在重复分类 ID：${id}。` } };
    }
    categoryIds.add(id);
  }

  const entryIds = new Set<string>();
  for (const entry of timeEntries) {
    const { id } = entry;
    if (entryIds.has(id)) {
      return { ok: false, error: { code: "DUPLICATE_ENTRY_ID", message: `备份文件中存在重复记录 ID：${id}。` } };
    }
    entryIds.add(id);
  }

  const treeError = validateCategoryTree(categories);
  if (treeError) {
    return treeError;
  }

  for (const entry of timeEntries) {
    const { id, categoryId } = entry;
    if (!categoryIds.has(categoryId)) {
      return {
        ok: false,
        error: { code: "ORPHAN_ENTRY_CATEGORY", message: `记录 ${id} 引用了不存在的分类 ${categoryId}。` },
      };
    }
  }

  const backup: BackupDocument = {
    format: BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt: exportedAt.data,
    appVersion: value.appVersion,
    device,
    categories,
    timeEntries,
    domains,
  };
  return {
    ok: true,
    backup,
    summary: {
      exportedAt: backup.exportedAt,
      categoryCount: backup.categories.length,
      entryCount: backup.timeEntries.length,
      domainCounts,
    },
  };
}
