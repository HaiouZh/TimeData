import "fake-indexeddb/auto";
import type { Category, QuickNote, Task, TimeEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { BACKUP_BUNDLED_DOMAINS } from "../sync/clientDomains.js";
import { exportBackup } from "./exportBackup.js";
import { BACKUP_FORMAT } from "./schema.js";

const now = "2026-05-07T12:00:00.000Z";

const category: Category = {
  id: "cat-1",
  name: "编程",
  parentId: null,
  color: "#4A90D9",
  icon: null,
  sortOrder: 1,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};

const entry: TimeEntry = {
  id: "entry-1",
  categoryId: "cat-1",
  startTime: "2026-05-07T10:00:00.000Z",
  endTime: "2026-05-07T11:00:00.000Z",
  note: "备份测试",
  createdAt: now,
  updatedAt: now,
};

const task: Task = {
  id: "task-1",
  title: "写备份测试",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,  completedCount: 0,
  sortOrder: 1,
  createdAt: now,
  updatedAt: now,
};

const quickNote: QuickNote = {
  id: "note-1",
  text: "备份速记",
  occurredAt: now,
  createdAt: now,
  updatedAt: now,
};

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.tasks.clear();
  await db.quickNotes.clear();
  await db.syncLog.clear();
  await db.categories.clear();
});

describe("exportBackup", () => {
  it("exports core tables plus every bundled domain (tasks, quick notes, health) keyed by table name", async () => {
    await db.categories.add(category);
    await db.timeEntries.add(entry);
    await db.tasks.add(task);
    await db.quickNotes.add(quickNote);

    const backup = await exportBackup({
      now: () => "2026-05-07T12:30:00.000Z",
      appVersion: "0.1.0-test",
      device: { deviceId: "device-1", deviceName: "Web" },
    });

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.timeFormat).toBe("utc");
    expect(backup.exportedAt).toBe("2026-05-07T12:30:00.000Z");
    expect(backup.appVersion).toBe("0.1.0-test");
    expect(backup.device).toEqual({ deviceId: "device-1", deviceName: "Web" });
    expect(backup.categories).toEqual([category]);
    expect(backup.timeEntries).toEqual([entry]);

    // 普通域走通用 domains map，按 table 名键入；速记与任务都在
    expect(backup.domains.tasks).toEqual([task]);
    expect(backup.domains.quick_notes).toEqual([quickNote]);

    // 完整导出始终写齐全部 bundled 域（空的也写成 []）
    for (const domain of BACKUP_BUNDLED_DOMAINS) {
      expect(backup.domains[domain.table]).toBeDefined();
    }
    expect(backup.domains.health_sleep).toEqual([]);
  });
});
