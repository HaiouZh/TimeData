import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  Category, Goal, GoalLayoutPin, GoalPrerequisite, QuickNote, Session, Setting, Task, TaskRelation, TimeEntry, SyncLogEntry, Track, TrackStep,
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
  migrationSnapshots: EntityTable<MigrationSnapshot, "key">;
};

/** 纯本地快照行：value 存 JSON 字符串，不进任何同步域（见 v19 注释）。 */
export interface MigrationSnapshot {
  key: string;
  value: string;
  updatedAt: string;
}

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
// 搬入完成后旧字段会被清空（见 migrateGoalPrerequisitesToRelations），原样数组存进 v19 快照表作回滚底牌。
db.version(18).stores({
  taskRelations: "[blockerKind+blockerId+blockedKind+blockedId], blockerId, blockedId, updatedAt",
});

// 阶段3 底牌：迁移清空 goal.prerequisites 前把原样数组快照进这张纯本地表（key → JSON 字符串）。
// 纯本地有两层含义：不登记任何同步域（force-push 的 settings 整表推送、resetLocalDataToDefaults 的
// settings.clear() 都会毁掉它），也不进 resetLocalDataToDefaults 的清空清单。
db.version(19).stores({
  migrationSnapshots: "key",
});

export async function seedDefaultCategories(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  await db.categories.bulkAdd(createDefaultCategories());
}

/** 迁移快照在 migrationSnapshots 表里的 key。 */
export const GOAL_PREREQUISITES_SNAPSHOT_KEY = "migration.v18.prerequisitesSnapshot";

/** 把存量 goal.prerequisites 搬进 taskRelations，返回新搬入的条数。
 *  幂等：复合主键天然去重，已存在的边跳过、不重复记 syncLog。
 *  每个旧字段非空的 goal 搬完边后：原样数组并入快照（GOAL_PREREQUISITES_SNAPSHOT_KEY，含坏边）、
 *  清空旧字段并直写 update syncLog——否则「用户删边 → 关系行没了 → 下次启动把旧字段的边搬回来」会复活。
 *  快照由 restoreGoalPrerequisitesFromSnapshot 消费，可重复跑。 */
export async function migrateGoalPrerequisitesToRelations(now: Date = new Date()): Promise<number> {
  const timestamp = now.toISOString();
  let migrated = 0;

  await db.transaction("rw", db.goals, db.taskRelations, db.syncLog, db.migrationSnapshots, async () => {
    const goals = await db.goals.toArray();
    const delta: Record<string, GoalPrerequisite[]> = {};
    for (const goal of goals) {
      if ((goal.prerequisites ?? []).length === 0) continue;
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

      // 原样并入快照（含坏边，不过滤）：底牌要能完整还原，坏边同样会被下一步清掉。
      delta[goal.id] = goal.prerequisites ?? [];
      // 清空旧字段并刷新 updatedAt——不刷新的话 LWW 下这次清空推不过服务端上的旧版本。
      await db.goals.put({ ...goal, prerequisites: [], updatedAt: timestamp });
      await db.syncLog.add({
        id: uuid(),
        tableName: "goals",
        recordId: goal.id,
        action: "update",
        timestamp,
        synced: 0,
      });
    }

    // delta 为空时一个字都不许写：不新建行、不更新 updatedAt。
    if (Object.keys(delta).length === 0) return;

    // 合并而非覆盖：新设备首启时 goals 是空的会先落空快照，等真数据同步进来、下次启动搬走时，
    // 「已存在就不写」会让底牌永远停在空对象上；合并没有这个洞——已搬过的 goal 旧字段已空、进不来。
    const existing = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    let merged: Record<string, GoalPrerequisite[]> = {};
    if (existing) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(existing.value);
      } catch {
        parsed = null;
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        merged = parsed as Record<string, GoalPrerequisite[]>;
      } else {
        // 坏快照不许静默丢底牌：解析失败（非法 JSON 或不是对象）时，把原始 value 原样另存到
        // corrupt key 作留档，再用本次 delta 建新行——否则历史每一轮攒下的底牌会整体消失。
        await db.migrationSnapshots.put({
          key: `${GOAL_PREREQUISITES_SNAPSHOT_KEY}.corrupt.${timestamp}`,
          value: existing.value,
          updatedAt: timestamp,
        });
      }
    }
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: JSON.stringify({ ...merged, ...delta }),
      updatedAt: timestamp,
    });
  });

  return migrated;
}

/** 用迁移快照里的原样记录重建 taskRelations，返回实际新落边数/失败边数。
 *  读取侧只读关系表（见 lib/goalPrerequisiteHydration.ts），旧字段 goal.prerequisites 是死水，
 *  写回它既不上界面、也活不过下次启动迁移，还可能把用户删过的边复活——所以重建目标就是关系表本身。
 *  每条边一个独立事务：单条写不进去（形状不合、落库异常）不拖垮其余的。不删快照，可重复跑。 */
export async function restoreGoalPrerequisitesFromSnapshot(
  now?: Date,
): Promise<{ restored: number; failed: number }> {
  const row = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
  if (!row) return { restored: 0, failed: 0 };

  let snapshot: Record<string, GoalPrerequisite[]>;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { restored: 0, failed: 0 };
    }
    snapshot = parsed as Record<string, GoalPrerequisite[]>;
  } catch {
    return { restored: 0, failed: 0 };
  }

  const timestamp = (now ?? new Date()).toISOString();
  let restored = 0;
  let failed = 0;
  for (const prerequisites of Object.values(snapshot)) {
    for (const edge of prerequisites ?? []) {
      const raw = {
        blockerKind: edge?.blocker?.kind,
        blockerId: edge?.blocker?.id,
        blockedKind: edge?.blocked?.kind,
        blockedId: edge?.blocked?.id,
        type: "blocks" as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const parsed = TaskRelationSchema.safeParse(raw);
      if (!parsed.success) {
        failed += 1;
        continue;
      }
      const relation = parsed.data;
      try {
        let alreadyExists = false;
        await db.transaction("rw", db.taskRelations, db.syncLog, async () => {
          const key: [string, string, string, string] = [
            relation.blockerKind,
            relation.blockerId,
            relation.blockedKind,
            relation.blockedId,
          ];
          if (await db.taskRelations.get(key)) {
            alreadyExists = true;
            return;
          }
          await db.taskRelations.put(relation);
          await db.syncLog.add({
            id: uuid(),
            tableName: "task_relations",
            recordId: taskRelationKey(relation),
            action: "create",
            timestamp,
            synced: 0,
          });
        });
        if (!alreadyExists) restored += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { restored, failed };
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
  // 有意不清 migrationSnapshots（迁移快照是纯本地底牌，见 v19 注释）：重置本地数据之后
  // goals 会从服务端重新拉到「已清空」的版本，那正是最需要底牌的时刻。
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
