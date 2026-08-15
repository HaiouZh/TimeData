import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  Category, Goal, GoalLayoutPin, QuickNote, Session, Setting, Task, TaskRelation, TimeEntry, SyncLogEntry, Track, TrackStep,
} from "@timedata/shared";
import { createDefaultCategories, taskRelationKey, TaskRelationSchema } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { safeGetItem, safeRemoveItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { syncScheduler } from "../sync/scheduler.js";

export const LAST_SYNCED_SEQ_KEY = STORAGE_KEYS.lastSyncedSeq;

export function resetSyncCursors(): void {
  safeRemoveItem(STORAGE_KEYS.lastSyncedSeq);
  // timestamp cursor 与 legacy 快照开关已退役，顺手清理老设备上的残留 key。
  safeRemoveItem("timedata_last_synced");
  safeRemoveItem("timedata_legacy_snapshot_sync");
}

export const db = new Dexie("timedata") as Dexie & {
  categories: EntityTable<Category, "id">;
  quickNotes: EntityTable<QuickNote, "id">;
  timeEntries: EntityTable<TimeEntry, "id">;
  tasks: EntityTable<Task, "id">;
  syncLog: EntityTable<SyncLogEntry, "id">;
  settings: EntityTable<Setting, "key">;
  tracks: EntityTable<Track, "id">;
  trackSteps: EntityTable<TrackStep, "id">;
  goals: EntityTable<Goal, "id">;
  goalLayoutPins: Table<GoalLayoutPin, [string, GoalLayoutPin["nodeKind"], string]>;
  sessions: EntityTable<Session, "id">;
  taskRelations: Table<TaskRelation, [string, string, string, string]>;
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

db.version(13).stores({
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
}).upgrade(async (tx) => {
  await tx.table("tasks").toCollection().modify((task: { weight?: number }) => {
    if (task.weight === undefined) task.weight = 0;
  });
});

db.version(14)
  .stores({
    categories: "id, parentId, sortOrder",
    quickNotes: "id, occurredAt, updatedAt",
    timeEntries: "id, categoryId, startTime, endTime",
    tasks: "id, parentId, ruleId, scheduledAt, sortOrder, updatedAt",
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
  })
  .upgrade(async (tx) => {
    await tx.table("tasks").toCollection().modify((task: { ruleId?: string | null; skipped?: boolean }) => {
      if (task.ruleId === undefined) task.ruleId = null;
      if (task.skipped === undefined) task.skipped = false;
    });
  });

db.version(15).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, ruleId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  goals: "id, kind, status, updatedAt",
  goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: null,
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
});

db.version(16)
  .stores({
    categories: "id, parentId, sortOrder",
    quickNotes: "id, occurredAt, updatedAt",
    timeEntries: "id, categoryId, startTime, endTime",
    tasks: "id, parentId, ruleId, sessionId, scheduledAt, sortOrder, updatedAt",
    tracks: "id, status, updatedAt",
    trackSteps: "id, trackId, [trackId+seq], updatedAt",
    goals: "id, kind, status, updatedAt",
    goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt",
    syncLog: "id, tableName, recordId, synced, [tableName+synced]",
    settings: "key",
    healthHeartRate: "id, date",
    healthHrv: "id, date",
    healthSleep: "id, date",
    healthStress: "id, date",
    runs: "id, date",
    healthCharts: "id, order, updatedAt",
    sessions: "id, startedAt, updatedAt",
  })
  .upgrade(async (tx) => {
    await tx.table("tasks").toCollection().modify((task: { sessionId?: string | null }) => {
      if (task.sessionId === undefined) task.sessionId = null;
    });
  });

// 退役健康数据层（ADR 0031）：6 个健康 store 置 null 删除，本地数据随之清空。
// 服务端同步域已一并删除，本地不再有任何生产者或消费者；历史数据存于服务端 SQL 存档与 run-track。
db.version(17).stores({
  healthHeartRate: null,
  healthHrv: null,
  healthSleep: null,
  healthStress: null,
  runs: null,
  healthCharts: null,
});

// 阶段3 关系表：前置边从 goal.prerequisites 内嵌数组搬进独立 store。
// goal.prerequisites 原样保留不删——它是回滚底牌。
db.version(18).stores({
  taskRelations: "[blockerKind+blockerId+blockedKind+blockedId], blockerId, blockedId, updatedAt",
});

export async function seedDefaultCategories(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  await db.categories.bulkAdd(createDefaultCategories());
}

/** 把存量 goal.prerequisites 搬进 taskRelations，返回新搬入的条数。
 *  幂等：复合主键天然去重，已存在的边跳过、不重复记 syncLog。
 *  **不删除 goal.prerequisites**——它是回滚底牌。 */
export async function migrateGoalPrerequisitesToRelations(now: Date = new Date()): Promise<number> {
  const timestamp = now.toISOString();
  let migrated = 0;

  await db.transaction("rw", db.goals, db.taskRelations, db.syncLog, async () => {
    const goals = await db.goals.toArray();
    for (const goal of goals) {
      for (const edge of goal.prerequisites ?? []) {
        const raw = {
          blockerKind: edge?.blocker?.kind,
          blockerId: edge?.blocker?.id,
          blockedKind: edge?.blocked?.kind,
          blockedId: edge?.blocked?.id,
          type: "blocks" as const,
          createdAt: goal.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const parsed = TaskRelationSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("[migration] 跳过形状不合的前置边", { goalId: goal.id, edge });
          continue;
        }
        const relation = parsed.data;
        const key: [string, string, string, string] = [
          relation.blockerKind,
          relation.blockerId,
          relation.blockedKind,
          relation.blockedId,
        ];
        if (await db.taskRelations.get(key)) continue;
        await db.taskRelations.put(relation);
        await db.syncLog.add({
          id: uuid(),
          tableName: "task_relations",
          recordId: taskRelationKey(relation),
          action: "create",
          timestamp,
          synced: 0,
        });
        migrated += 1;
      }
    }
  });

  return migrated;
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
  syncScheduler.notifyWrite();
}

export async function resetLocalDataToDefaults(): Promise<void> {
  await db.transaction("rw", [db.categories, db.timeEntries, db.tasks, db.tracks, db.trackSteps, db.goals, db.goalLayoutPins, db.taskRelations, db.syncLog, db.settings], async () => {
    const nonQuickNoteLogs = await db.syncLog.filter((log) => log.tableName !== "quick_notes").toArray();
    await db.timeEntries.clear();
    await db.goals.clear();
    await db.goalLayoutPins.clear();
    await db.tasks.clear();
    await db.trackSteps.clear();
    await db.tracks.clear();
    await db.taskRelations.clear();
    await db.syncLog.bulkDelete(nonQuickNoteLogs.map((log) => log.id));
    await db.settings.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(createDefaultCategories());
  });

  // 两个速记草稿 key 与 Dexie 事务无关，放事务外跟游标一起清——不清的话「清空本地数据」后
  // 未发出的速记正文仍留在本机，共享设备上会在下次唤起输入框时直接显示出来。
  safeRemoveItem(STORAGE_KEYS.quickNoteComposerDraft);
  safeRemoveItem(STORAGE_KEYS.captureComposerDraft);
  resetSyncCursors();
}
