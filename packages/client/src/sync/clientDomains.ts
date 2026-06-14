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
  },
  settings: {
    table: "settings",
    storeName: "settings",
    schema: SettingSchema,
    needsApply: (existing, remote) =>
      settingNeedsApply(existing as Setting | undefined, remote as Setting),
  },
  quick_notes: {
    table: "quick_notes",
    storeName: "quickNotes",
    schema: QuickNoteSchema,
    needsApply: (existing, remote) =>
      quickNoteNeedsApply(existing as QuickNote | undefined, remote as QuickNote),
  },
  tasks: {
    table: "tasks",
    storeName: "tasks",
    schema: TaskSchema,
    needsApply: (existing, remote) =>
      taskNeedsApply(existing as Task | undefined, remote as Task),
  },
  health_heart_rate: {
    table: "health_heart_rate",
    storeName: "healthHeartRate",
    schema: HealthHeartRateSchema,
  },
  health_hrv: {
    table: "health_hrv",
    storeName: "healthHrv",
    schema: HealthHrvSchema,
  },
  health_sleep: {
    table: "health_sleep",
    storeName: "healthSleep",
    schema: HealthSleepSchema,
  },
  health_stress: {
    table: "health_stress",
    storeName: "healthStress",
    schema: HealthStressSchema,
  },
  runs: {
    table: "runs",
    storeName: "runs",
    schema: HealthRunSchema,
  },
};

export function getClientDomain(table: string): ClientDomainConfig {
  const domain = CLIENT_SYNC_DOMAINS[table];
  if (!domain) throw new Error(`Unknown client sync domain: ${table}`);
  return domain;
}

/** Parse remote data using domain schema. Returns null if invalid. */
export function parseRemoteRecord(domain: ClientDomainConfig, data: unknown, recordId: string): unknown | null {
  const parsed = domain.schema.safeParse(data);
  if (parsed.success) return parsed.data;
  console.warn(`[sync] dropping invalid ${domain.table} payload for ${recordId}:`, parsed.error.issues);
  return null;
}
