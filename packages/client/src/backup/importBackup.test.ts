import "fake-indexeddb/auto";
import type { Category, Goal, SyncLogEntry, Task, TimeEntry, Track, TrackStep } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { LAST_SYNCED_SEQ_KEY, db } from "../db/index.js";
import { importBackup } from "./importBackup.js";
import { BACKUP_FORMAT, type BackupDocument } from "./schema.js";

const now = "2026-05-07T12:00:00.000Z";
const legacyStateField = "tu" + "rn";
const legacyStateTimeField = `${legacyStateField}At`;

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const oldCategory: Category = {
  id: "old-cat",
  name: "旧分类",
  parentId: null,
  color: "#111111",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};

const oldEntry: TimeEntry = {
  id: "old-entry",
  categoryId: "old-cat",
  startTime: "2026-05-07T08:00:00.000Z",
  endTime: "2026-05-07T09:00:00.000Z",
  note: "旧记录",
  createdAt: now,
  updatedAt: now,
};

const oldTask: Task = {
  id: "old-task",
  parentId: null,
  title: "旧任务",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  completedCount: 0,
  weight: 0,
  completedAt: null,
  tags: [],
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
};

const newCategory: Category = {
  id: "new-cat",
  name: "新分类",
  parentId: null,
  color: "#4A90D9",
  icon: null,
  sortOrder: 1,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};

const newEntry: TimeEntry = {
  id: "new-entry",
  categoryId: "new-cat",
  startTime: "2026-05-07T10:00:00.000Z",
  endTime: "2026-05-07T11:00:00.000Z",
  note: "恢复测试",
  createdAt: now,
  updatedAt: now,
};

const newTask = {
  id: "new-task",
  title: "新任务",
  done: true,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  completedCount: 0,
  weight: 0,
  sortOrder: 1,
  createdAt: now,
  updatedAt: now,
} satisfies Omit<Task, "parentId" | "completedAt" | "tags">;

const normalizedNewTask: Task = { ...newTask, parentId: null, completedAt: null, tags: [] };

const oldTrack: Track = {
  id: "old-track",
  title: "旧轨道",
  status: "active",
  refs: [],
  createdAt: now,
  updatedAt: now,
};

const newTrack: Track = {
  id: "new-track",
  title: "新轨道",
  status: "parked",
  refs: [{ kind: "task", id: "new-task" }],
  createdAt: now,
  updatedAt: now,
};

const newTrackStep: TrackStep = {
  id: "new-step",
  trackId: "new-track",
  source: "agent",
  content: "",
  startedAt: now,
  endedAt: null,
  refs: [],
  tags: ["phase:T1"],
  seq: 0,
  createdAt: now,
  updatedAt: now,
};

const oldGoal: Goal = {
  id: "old-goal",
  title: "旧目标",
  kind: "project",
  status: "active",
  members: [],
  prerequisites: [],
  createdAt: now,
  updatedAt: now,
};

const newGoal: Goal = {
  id: "new-goal",
  title: "新目标",
  kind: "theme",
  status: "active",
  members: [
    { kind: "task", id: "new-task" },
    { kind: "track", id: "new-track" },
  ],
  prerequisites: [
    {
      blocker: { kind: "task", id: "new-task" },
      blocked: { kind: "track", id: "new-track" },
    },
  ],
  createdAt: now,
  updatedAt: now,
};

const oldGoalLayoutPin = {
  goalId: "old-goal",
  nodeKind: "goal" as const,
  nodeId: "old-goal",
  x: 12,
  y: 24,
  updatedAt: now,
};

const newGoalLayoutPin = {
  goalId: "new-goal",
  nodeKind: "goal" as const,
  nodeId: "new-goal",
  x: 320,
  y: 180,
  updatedAt: now,
};

const syncLog: SyncLogEntry = {
  id: "sync-1",
  tableName: "categories",
  recordId: "old-cat",
  action: "update",
  timestamp: now,
  synced: 1,
};

function backup(): BackupDocument {
  return {
    format: BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt: now,
    appVersion: "0.1.0-test",
    device: { deviceId: "device-1", deviceName: "Web" },
    categories: [newCategory],
    timeEntries: [newEntry],
    domains: { tasks: [newTask] },
  };
}

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.goals.clear();
  await db.tasks.clear();
  await db.trackSteps.clear();
  await db.tracks.clear();
  await db.quickNotes.clear();
  await db.syncLog.clear();
  await db.categories.clear();
  localStorage.clear();
});

describe("importBackup", () => {
  it("replaces local categories, entries and tasks and clears sync state", async () => {
    await db.categories.add(oldCategory);
    await db.timeEntries.add(oldEntry);
    await db.tasks.add(oldTask);
    await db.syncLog.add(syncLog);
    localStorage.setItem("timedata_last_synced", "2026-05-07T13:00:00.000Z");
    localStorage.setItem(LAST_SYNCED_SEQ_KEY, "42");

    const result = await importBackup(backup());

    await expect(db.categories.toArray()).resolves.toEqual([newCategory]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([newEntry]);
    await expect(db.tasks.toArray()).resolves.toEqual([normalizedNewTask]);
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
    expect(localStorage.getItem("timedata_last_synced")).toBeNull();
    expect(localStorage.getItem(LAST_SYNCED_SEQ_KEY)).toBeNull();
    expect(result).toEqual({ categoryCount: 1, entryCount: 1, domainCounts: { tasks: 1 } });
  });

  it("leaves domains absent from the backup untouched (auto-backup restore keeps quick notes)", async () => {
    await db.quickNotes.add({ id: "keep-note", text: "保留我", occurredAt: now, createdAt: now, updatedAt: now });
    await db.tasks.add(oldTask);
    await db.tracks.add(oldTrack);

    // backup() 只含 tasks 域，不含 quick_notes —— 恢复后速记应原样保留
    const result = await importBackup(backup());

    await expect(db.tasks.toArray()).resolves.toEqual([normalizedNewTask]);
    await expect(db.quickNotes.toArray()).resolves.toEqual([
      { id: "keep-note", text: "保留我", occurredAt: now, createdAt: now, updatedAt: now },
    ]);
    await expect(db.tracks.toArray()).resolves.toEqual([oldTrack]);
    expect(result.domainCounts).toEqual({ tasks: 1 });
  });

  it("旧备份任务带已退役状态字段时导入后剥离", async () => {
    const backupWithLegacyTask = {
      ...backup(),
      domains: {
        tasks: [
          {
            ...newTask,
            [legacyStateField]: "running",
            [legacyStateTimeField]: "2026-05-07T13:00:00.000Z",
          },
        ],
      },
    } as BackupDocument;

    const result = await importBackup(backupWithLegacyTask);

    const tasks = await db.tasks.toArray();
    expect(tasks).toEqual([normalizedNewTask]);
    expect(Object.hasOwn(tasks[0] ?? {}, legacyStateField)).toBe(false);
    expect(Object.hasOwn(tasks[0] ?? {}, legacyStateTimeField)).toBe(false);
    expect(result.domainCounts).toEqual({ tasks: 1 });
  });

  it("restores tracks and track_steps when the backup includes those domains", async () => {
    await db.tracks.add(oldTrack);
    await db.goals.add(oldGoal);

    const result = await importBackup({
      ...backup(),
      domains: {
        tasks: [newTask],
        goals: [newGoal],
        tracks: [newTrack],
        track_steps: [newTrackStep],
      },
    });

    await expect(db.goals.toArray()).resolves.toEqual([newGoal]);
    await expect(db.tracks.toArray()).resolves.toEqual([newTrack]);
    await expect(db.trackSteps.toArray()).resolves.toEqual([newTrackStep]);
    expect(result.domainCounts).toEqual({ tasks: 1, goals: 1, tracks: 1, track_steps: 1 });
  });

  it("restores goal layout pins when the backup includes that domain", async () => {
    await db.goalLayoutPins.add(oldGoalLayoutPin);

    const result = await importBackup({
      ...backup(),
      domains: {
        tasks: [newTask],
        goal_layout_pins: [newGoalLayoutPin],
      },
    });

    await expect(db.goalLayoutPins.toArray()).resolves.toEqual([newGoalLayoutPin]);
    expect(result.domainCounts).toEqual({ tasks: 1, goal_layout_pins: 1 });
  });

  it("does not modify local data when validation fails", async () => {
    await db.categories.add(oldCategory);
    await db.timeEntries.add(oldEntry);
    await db.tasks.add(oldTask);

    await expect(importBackup({ ...backup(), timeEntries: [{ ...newEntry, categoryId: "missing" }] })).rejects.toThrow(
      "记录 new-entry 引用了不存在的分类 missing。",
    );

    await expect(db.categories.toArray()).resolves.toEqual([oldCategory]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([oldEntry]);
    await expect(db.tasks.toArray()).resolves.toEqual([oldTask]);
  });

  it("keeps current category names for matching ids when importing an older external backup", async () => {
    const currentCategory: Category = {
      ...oldCategory,
      name: "当前名称",
      updatedAt: "2026-05-08T12:00:00.000Z",
    };
    const externalBackupCategory: Category = {
      ...oldCategory,
      name: "旧备份名称",
      updatedAt: "2026-05-07T12:00:00.000Z",
    };
    const externalBackupEntry: TimeEntry = {
      ...oldEntry,
      note: "仍然关联同一个分类 ID",
    };

    await db.categories.add(currentCategory);

    const result = await importBackup({
      ...backup(),
      categories: [externalBackupCategory],
      timeEntries: [externalBackupEntry],
    });

    await expect(db.categories.toArray()).resolves.toEqual([
      {
        ...externalBackupCategory,
        name: "当前名称",
      },
    ]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([externalBackupEntry]);
    expect(result).toEqual({ categoryCount: 1, entryCount: 1, domainCounts: { tasks: 1 } });
  });
});
