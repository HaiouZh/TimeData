import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  Category, Goal, GoalLayoutPin, QuickNote, Setting, Task, TimeEntry, SyncLogEntry, Track, TrackStep,
  HealthHeartRate, HealthHrv, HealthSleep, HealthStress, HealthRun, HealthChartConfig,
} from "@timedata/shared";
import { createDefaultCategories } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { safeGetItem, safeRemoveItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export const LAST_SYNCED_SEQ_KEY = STORAGE_KEYS.lastSyncedSeq;

export function resetSyncCursors(): void {
  safeRemoveItem(STORAGE_KEYS.lastSyncedSeq);
  // timestamp cursor 与 legacy 快照开关已退役，顺手清理老设备上的残留 key。
  safeRemoveItem("timedata_last_synced");
  safeRemoveItem("timedata_legacy_snapshot_sync");
}

export interface AutoBackupRecord {
  id: string;
  createdAt: string;
  categories: Category[];
  timeEntries: TimeEntry[];
  tasks: Task[];
}

export const db = new Dexie("timedata") as Dexie & {
  categories: EntityTable<Category, "id">;
  quickNotes: EntityTable<QuickNote, "id">;
  timeEntries: EntityTable<TimeEntry, "id">;
  tasks: EntityTable<Task, "id">;
  syncLog: EntityTable<SyncLogEntry, "id">;
  autoBackups: EntityTable<AutoBackupRecord, "id">;
  settings: EntityTable<Setting, "key">;
  healthHeartRate: EntityTable<HealthHeartRate, "id">;
  healthHrv: EntityTable<HealthHrv, "id">;
  healthSleep: EntityTable<HealthSleep, "id">;
  healthStress: EntityTable<HealthStress, "id">;
  runs: EntityTable<HealthRun, "id">;
  healthCharts: EntityTable<HealthChartConfig, "id">;
  tracks: EntityTable<Track, "id">;
  trackSteps: EntityTable<TrackStep, "id">;
  goals: EntityTable<Goal, "id">;
  goalLayoutPins: Table<GoalLayoutPin, [string, GoalLayoutPin["nodeKind"], string]>;
};

db.version(1).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
});

db.version(2).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
});

db.version(3).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
});

db.version(4).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
});

db.version(5).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, sortOrder, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
});

db.version(6).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, scheduledAt, sortOrder, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
});

db.version(7).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, scheduledAt, sortOrder, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(8).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, scheduledAt, sortOrder, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(9).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(10).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, goalId, parentId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, goalId, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  goals: "id, kind, status, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(11).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  goals: "id, kind, status, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(12).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  goals: "id, kind, status, updatedAt",
  goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

export async function seedDefaultCategories(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  await db.categories.bulkAdd(createDefaultCategories());
}

export async function migrateLocalSettingsToDexie(): Promise<void> {
  const legacySleepCategoryId = safeGetItem(STORAGE_KEYS.sleepCategoryId);
  if (!legacySleepCategoryId) return;

  const existing = await db.settings.get("sleep.categoryId");
  if (existing) return;

  const now = new Date().toISOString();
  await db.transaction("rw", db.settings, db.syncLog, async () => {
    await db.settings.put({ key: "sleep.categoryId", value: legacySleepCategoryId, updatedAt: now });
    await db.syncLog.add({
      id: uuid(),
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "create",
      timestamp: now,
      synced: 0,
    });
  });
}

export async function resetLocalDataToDefaults(): Promise<void> {
  await db.transaction("rw", [db.categories, db.timeEntries, db.tasks, db.tracks, db.trackSteps, db.goals, db.goalLayoutPins, db.syncLog, db.settings], async () => {
    const nonQuickNoteLogs = await db.syncLog.filter((log) => log.tableName !== "quick_notes").toArray();
    await db.timeEntries.clear();
    await db.goals.clear();
    await db.goalLayoutPins.clear();
    await db.tasks.clear();
    await db.trackSteps.clear();
    await db.tracks.clear();
    await db.syncLog.bulkDelete(nonQuickNoteLogs.map((log) => log.id));
    await db.settings.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(createDefaultCategories());
  });

  resetSyncCursors();
}
