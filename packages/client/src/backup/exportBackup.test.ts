import "fake-indexeddb/auto";
import type { Category, Task, TimeEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
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
  sortOrder: 1,
  createdAt: now,
  updatedAt: now,
};

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
  await db.categories.clear();
});

describe("exportBackup", () => {
  it("exports all categories, time entries and tasks in Backup JSON", async () => {
    await db.categories.add(category);
    await db.timeEntries.add(entry);
    await db.tasks.add(task);

    const backup = await exportBackup({
      now: () => "2026-05-07T12:30:00.000Z",
      appVersion: "0.1.0-test",
      device: { deviceId: "device-1", deviceName: "Web" },
    });

    expect(backup).toEqual({
      format: BACKUP_FORMAT,
      timeFormat: "utc",
      exportedAt: "2026-05-07T12:30:00.000Z",
      appVersion: "0.1.0-test",
      device: { deviceId: "device-1", deviceName: "Web" },
      categories: [category],
      timeEntries: [entry],
      tasks: [task],
    });
  });
});
