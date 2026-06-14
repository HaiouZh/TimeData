import { describe, expect, it } from "vitest";
import type { Category, Task, TimeEntry } from "@timedata/shared";
import { BACKUP_FORMAT } from "./schema.js";
import { validateBackup } from "./validateBackup.js";

const now = "2026-05-07T12:00:00.000Z";

function category(overrides: Partial<Category> & Pick<Category, "id">): Category;
function category(id: string, parentId?: string | null): Category;
function category(
  value: string | (Partial<Category> & Pick<Category, "id">),
  parentId: string | null = null,
): Category {
  const overrides = typeof value === "string" ? { id: value, parentId } : value;
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    parentId: overrides.parentId ?? null,
    color: overrides.color ?? "#4A90D9",
    icon: overrides.icon ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    isArchived: overrides.isArchived ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function entry(overrides: Partial<TimeEntry> & Pick<TimeEntry, "id">): TimeEntry;
function entry(id: string, categoryId?: string): TimeEntry;
function entry(value: string | (Partial<TimeEntry> & Pick<TimeEntry, "id">), categoryId = "cat-1"): TimeEntry {
  const overrides = typeof value === "string" ? { id: value, categoryId } : value;
  return {
    id: overrides.id,
    categoryId: overrides.categoryId ?? "cat-1",
    startTime: overrides.startTime ?? "2026-05-07T10:00:00.000Z",
    endTime: overrides.endTime ?? "2026-05-07T11:00:00.000Z",
    note: overrides.note ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id">): Task;
function task(id: string): Task;
function task(value: string | (Partial<Task> & Pick<Task, "id">)): Task {
  const overrides = typeof value === "string" ? { id: value } : value;
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    done: overrides.done ?? false,
    recurrence: overrides.recurrence ?? null,
    lastDoneAt: overrides.lastDoneAt ?? null,
    startAt: overrides.startAt ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function validBackup(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    timeFormat: "utc" as const,
    exportedAt: now,
    appVersion: "0.1.0-test",
    device: { deviceId: "device-1", deviceName: "Web" },
    categories: [category("cat-1")],
    timeEntries: [entry("entry-1")],
    domains: { tasks: [task("task-1")] },
    ...overrides,
  };
}

describe("validateBackup", () => {
  it("accepts a valid backup and returns a summary", () => {
    const result = validateBackup(validBackup());

    expect(result).toEqual({
      ok: true,
      backup: validBackup(),
      summary: {
        exportedAt: now,
        categoryCount: 1,
        entryCount: 1,
        domainCounts: { tasks: 1 },
      },
    });
  });

  it("rejects an unknown format", () => {
    const result = validateBackup({ ...validBackup(), format: "other" });

    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_FORMAT", message: "备份文件格式不支持。" },
    });
  });

  it("rejects duplicate category ids", () => {
    const result = validateBackup({ ...validBackup(), categories: [category("cat-1"), category("cat-1")] });

    expect(result).toEqual({
      ok: false,
      error: { code: "DUPLICATE_CATEGORY_ID", message: "备份文件中存在重复分类 ID：cat-1。" },
    });
  });

  it("rejects duplicate ids inside a bundled domain", () => {
    const result = validateBackup({ ...validBackup(), domains: { tasks: [task("task-1"), task("task-1")] } });

    expect(result).toEqual({
      ok: false,
      error: { code: "DUPLICATE_DOMAIN_ID", message: "备份文件中 tasks 存在重复 ID：task-1。" },
    });
  });

  it("rejects orphan category parents", () => {
    const result = validateBackup({ ...validBackup(), categories: [category("cat-1", "missing-parent")] });

    expect(result).toEqual({
      ok: false,
      error: { code: "ORPHAN_CATEGORY_PARENT", message: "分类 cat-1 引用了不存在的父分类 missing-parent。" },
    });
  });

  it("rejects orphan entry categories", () => {
    const result = validateBackup({ ...validBackup(), timeEntries: [entry("entry-1", "missing-category")] });

    expect(result).toEqual({
      ok: false,
      error: { code: "ORPHAN_ENTRY_CATEGORY", message: "记录 entry-1 引用了不存在的分类 missing-category。" },
    });
  });

  it("rejects v2 backups without utc timeFormat", () => {
    const missingTimeFormat = validBackup({ timeFormat: undefined });
    expect(validateBackup(missingTimeFormat)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_TIME_FORMAT" }),
      }),
    );

    const localBackup = validBackup({ timeFormat: "local" });
    expect(validateBackup(localBackup)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_TIME_FORMAT" }),
      }),
    );
  });

  it("rejects categories with non-strict UTC timestamps", () => {
    const result = validateBackup({
      ...validBackup(),
      categories: [category({ id: "cat-1", createdAt: "2026-05-07T12:00:00Z" })],
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_CATEGORIES" }),
      }),
    );
  });

  it("rejects entries with non-UTC times or endTime not after startTime", () => {
    const nonUtc = validBackup({
      timeEntries: [entry({ id: "entry-1", startTime: "2026-05-17T09:00:00", endTime: "2026-05-17T10:00:00.000Z" })],
    });
    expect(validateBackup(nonUtc)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_TIME_ENTRIES" }),
      }),
    );

    const reversed = validBackup({
      timeEntries: [
        entry({ id: "entry-1", startTime: "2026-05-17T10:00:00.000Z", endTime: "2026-05-17T09:00:00.000Z" }),
      ],
    });
    expect(validateBackup(reversed)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_TIME_ENTRIES" }),
      }),
    );
  });

  it("treats an absent bundled domain as empty (not an error)", () => {
    // domains map 整体缺省 → 合法，所有普通域归一化为缺省（恢复时保留本地）
    const result = validateBackup(validBackup({ domains: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.domains).toEqual({});
      expect(result.summary.domainCounts).toEqual({});
    }
  });

  it("rejects a bundled domain that is present but not an array", () => {
    expect(validateBackup(validBackup({ domains: { tasks: "nope" } }))).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_DOMAIN_RECORDS" }),
      }),
    );
  });

  it("rejects invalid records inside a bundled domain", () => {
    expect(validateBackup(validBackup({ domains: { tasks: [task({ id: "task-1", title: "" })] } }))).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_DOMAIN_RECORDS" }),
      }),
    );
  });

  it("rejects invalid category parent relationships", () => {
    expect(validateBackup(validBackup({ categories: [category({ id: "a", parentId: "a" })] }))).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_CATEGORY_TREE" }),
      }),
    );

    expect(
      validateBackup(
        validBackup({
          categories: [
            category({ id: "a", parentId: null }),
            category({ id: "b", parentId: "a" }),
            category({ id: "c", parentId: "b" }),
          ],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_CATEGORY_TREE" }),
      }),
    );

    expect(
      validateBackup(
        validBackup({
          categories: [category({ id: "a", parentId: "b" }), category({ id: "b", parentId: "a" })],
          timeEntries: [],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_CATEGORY_TREE" }),
      }),
    );
  });
});

const NOW_V9 = new Date().toISOString();

function makeBackup(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    timeFormat: "utc" as const,
    exportedAt: NOW_V9,
    appVersion: "1.0.0",
    device: { deviceId: null, deviceName: "Web" },
    categories: [],
    timeEntries: [],
    domains: {},
    ...overrides,
  };
}

describe("validateBackup current format", () => {
  it("accepts a valid backup", () => {
    const result = validateBackup(makeBackup());
    expect(result.ok).toBe(true);
  });
});
