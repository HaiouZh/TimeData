import type { SyncChange } from "@timedata/shared";
import {
  CategorySchema,
  QuickNoteSchema,
  SettingSchema,
  TaskSchema,
  TimeEntrySchema,
  HealthHeartRateSchema,
  HealthHrvSchema,
  HealthSleepSchema,
  HealthStressSchema,
  HealthRunSchema,
  HealthChartConfigSchema,
  TrackSchema,
  TrackStepSchema,
} from "@timedata/shared";
import type { Category, QuickNote, Setting, Task, TimeEntry } from "@timedata/shared";
import { db } from "../db/index.ts";
import { categoryDependencyChangesForEntry } from "./changes.ts";

export interface ClientDomainConfig {
  /** Server table name (snake_case) = SyncChange.tableName */
  table: string;
  /** Dexie store name (camelCase) */
  storeName: string;
  /** Zod schema for parsing remote data */
  schema: { safeParse: (data: unknown) => { success: true; data: unknown } | { success: false; error: { issues: Array<{ message: string }> } } };
  /** Optional: custom push logic (e.g. time_entries category dependency injection) */
  beforePush?: (
    data: unknown,
    categoriesById: Map<string, Category>,
    timestamp: string,
    includedCategoryIds: Set<string>,
  ) => SyncChange[];
  /** Optional: custom remote delete handler (e.g. categories cascade) */
  applyRemoteDelete?: (recordId: string) => Promise<number>;
  /** Optional: custom check if upsert needs to be applied (default: compare updatedAt) */
  needsApply?: (existing: unknown | undefined, remote: unknown) => boolean;
  /** Optional: custom check for repair mode skip (e.g. time_entries isCompleteEntry) */
  shouldSkipOnRepair?: (existing: unknown, remote: unknown) => boolean;
  /**
   * 完整备份（timedata.backup）里的角色：
   * - "core"：核心业务表（categories/time_entries），有专属完整性校验，作为命名顶层字段导出
   * - "bundled"：普通状态域，进备份的通用 `domains` map（按 table 名键入），靠登记簿白捡
   * - "separate"：有独立导出通道（如速记额外的 quick-notes.backup），不强制混入——当前未使用
   * - "excluded"：不进备份（如 settings、机密域）
   * 缺省视为 "excluded"。机密域（未来的密码本）即便想进备份也必须先有加密通道，见 docs_local/ideas 备份加密路线。
   */
  backup?: "core" | "bundled" | "separate" | "excluded";
}

// --- Domain-specific helpers (extracted from engine.ts) ---

function quickNoteNeedsApply(existing: QuickNote | undefined, remoteNote: QuickNote): boolean {
  return !existing
    || existing.updatedAt !== remoteNote.updatedAt
    || existing.text !== remoteNote.text
    || existing.occurredAt !== remoteNote.occurredAt
    || (existing.pinned ?? false) !== (remoteNote.pinned ?? false);
}

function settingNeedsApply(existing: Setting | undefined, remote: Setting): boolean {
  return !existing || existing.updatedAt !== remote.updatedAt || existing.value !== remote.value;
}

function taskNeedsApply(existing: Task | undefined, remoteTask: Task): boolean {
  return !existing
    || existing.updatedAt !== remoteTask.updatedAt
    || existing.title !== remoteTask.title
    || existing.done !== remoteTask.done
    || JSON.stringify(existing.recurrence) !== JSON.stringify(remoteTask.recurrence)
    || existing.lastDoneAt !== remoteTask.lastDoneAt
    || existing.startAt !== remoteTask.startAt
    || existing.scheduledAt !== remoteTask.scheduledAt
    || existing.parentId !== remoteTask.parentId
    || existing.sortOrder !== remoteTask.sortOrder;
}

function isCompleteEntry(entry: TimeEntry): boolean {
  return Boolean(entry.categoryId && entry.startTime && entry.endTime);
}

// Categories cascade delete
async function applyRemoteCategoryDelete(categoryId: string): Promise<number> {
  return db.transaction("rw", db.categories, db.timeEntries, async () => {
    const categories = await db.categories.toArray();
    const target = categories.find((c) => c.id === categoryId);
    if (!target) return 0;

    const categoryIds = [target.id];
    for (let i = 0; i < categoryIds.length; i++) {
      const parentId = categoryIds[i];
      for (const cat of categories) {
        if (cat.parentId === parentId) categoryIds.push(cat.id);
      }
    }

    const idSet = new Set(categoryIds);
    const entries = await db.timeEntries.filter((e) => idSet.has(e.categoryId)).toArray();

    await db.timeEntries.bulkDelete(entries.map((e) => e.id));
    await db.categories.bulkDelete(categoryIds);

    return categoryIds.length + entries.length;
  });
}

// --- Registry ---

export const CLIENT_SYNC_DOMAINS: Record<string, ClientDomainConfig> = {
  categories: {
    table: "categories",
    storeName: "categories",
    schema: CategorySchema,
    applyRemoteDelete: applyRemoteCategoryDelete,
    backup: "core",
  },
  time_entries: {
    table: "time_entries",
    storeName: "timeEntries",
    schema: TimeEntrySchema,
    beforePush: (data, categoriesById, timestamp, includedCategoryIds) =>
      categoryDependencyChangesForEntry(
        data as TimeEntry,
        categoriesById,
        timestamp,
        includedCategoryIds,
      ),
    shouldSkipOnRepair: (existing, remote) => {
      const e = existing as TimeEntry;
      const r = remote as TimeEntry;
      return isCompleteEntry(e) && e.updatedAt >= r.updatedAt;
    },
    backup: "core",
  },
  settings: {
    table: "settings",
    storeName: "settings",
    schema: SettingSchema,
    needsApply: (existing, remote) =>
      settingNeedsApply(existing as Setting | undefined, remote as Setting),
    backup: "excluded",
  },
  quick_notes: {
    table: "quick_notes",
    storeName: "quickNotes",
    schema: QuickNoteSchema,
    needsApply: (existing, remote) =>
      quickNoteNeedsApply(existing as QuickNote | undefined, remote as QuickNote),
    backup: "bundled",
  },
  tasks: {
    table: "tasks",
    storeName: "tasks",
    schema: TaskSchema,
    needsApply: (existing, remote) =>
      taskNeedsApply(existing as Task | undefined, remote as Task),
    backup: "bundled",
  },
  health_heart_rate: {
    table: "health_heart_rate",
    storeName: "healthHeartRate",
    schema: HealthHeartRateSchema,
    backup: "bundled",
  },
  health_hrv: {
    table: "health_hrv",
    storeName: "healthHrv",
    schema: HealthHrvSchema,
    backup: "bundled",
  },
  health_sleep: {
    table: "health_sleep",
    storeName: "healthSleep",
    schema: HealthSleepSchema,
    backup: "bundled",
  },
  health_stress: {
    table: "health_stress",
    storeName: "healthStress",
    schema: HealthStressSchema,
    backup: "bundled",
  },
  runs: {
    table: "runs",
    storeName: "runs",
    schema: HealthRunSchema,
    backup: "bundled",
  },
  health_charts: {
    table: "health_charts",
    storeName: "healthCharts",
    schema: HealthChartConfigSchema,
    backup: "bundled",
  },
  tracks: {
    table: "tracks",
    storeName: "tracks",
    schema: TrackSchema,
    backup: "bundled",
  },
  track_steps: {
    table: "track_steps",
    storeName: "trackSteps",
    schema: TrackStepSchema,
    backup: "bundled",
  },
};

export function getClientDomain(table: string): ClientDomainConfig {
  const domain = CLIENT_SYNC_DOMAINS[table];
  if (!domain) throw new Error(`Unknown client sync domain: ${table}`);
  return domain;
}

/**
 * 完整备份里走通用 `domains` map 的普通状态域，按登记顺序排列。
 * 新增一个普通域只要在 CLIENT_SYNC_DOMAINS 标 `backup: "bundled"`，导出/校验/恢复全部白捡。
 */
export const BACKUP_BUNDLED_DOMAINS: ClientDomainConfig[] = Object.values(CLIENT_SYNC_DOMAINS).filter(
  (domain) => domain.backup === "bundled",
);

/** Parse remote data using domain schema. Returns null if invalid. */
export function parseRemoteRecord(domain: ClientDomainConfig, data: unknown, recordId: string): unknown | null {
  const parsed = domain.schema.safeParse(data);
  if (parsed.success) return parsed.data;
  console.warn(`[sync] dropping invalid ${domain.table} payload for ${recordId}:`, parsed.error.issues);
  return null;
}

export const __test = { taskNeedsApply };
