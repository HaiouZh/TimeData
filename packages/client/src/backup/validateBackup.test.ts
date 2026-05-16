import { describe, expect, it } from "vitest";
import type { Category, TimeEntry } from "@timedata/shared";
import { BACKUP_FORMAT_V1, BACKUP_FORMAT_V2 } from "./schema.js";
import { validateBackup } from "./validateBackup.js";

const now = "2026-05-07T12:00:00.000Z";

function category(id: string, parentId: string | null = null): Category {
  return {
    id,
    name: id,
    parentId,
    color: "#4A90D9",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

function entry(id: string, categoryId = "cat-1"): TimeEntry {
  return {
    id,
    categoryId,
    startTime: "2026-05-07T10:00:00.000Z",
    endTime: "2026-05-07T11:00:00.000Z",
    note: null,
    createdAt: now,
    updatedAt: now,
  };
}

function validBackup() {
  return {
    format: BACKUP_FORMAT_V2,
    timeFormat: "utc" as const,
    exportedAt: now,
    appVersion: "0.1.0-test",
    device: { deviceId: "device-1", deviceName: "Web" },
    categories: [category("cat-1")],
    timeEntries: [entry("entry-1")],
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

  it("rejects v1 backup with UNSUPPORTED_FORMAT", () => {
    const result = validateBackup({ ...validBackup(), format: BACKUP_FORMAT_V1 });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: "此备份使用旧版本格式（v1），与当前版本不兼容。请使用新版本应用重新导出备份。",
      },
    });
  });

  it("rejects duplicate category ids", () => {
    const result = validateBackup({ ...validBackup(), categories: [category("cat-1"), category("cat-1")] });

    expect(result).toEqual({
      ok: false,
      error: { code: "DUPLICATE_CATEGORY_ID", message: "备份文件中存在重复分类 ID：cat-1。" },
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
});

const NOW_V9 = new Date().toISOString();

function makeV2Backup(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT_V2,
    timeFormat: "utc" as const,
    exportedAt: NOW_V9,
    appVersion: "1.0.0",
    device: { deviceId: null, deviceName: "Web" },
    categories: [],
    timeEntries: [],
    ...overrides,
  };
}

describe("validateBackup v2", () => {
  it("accepts a valid v2 backup", () => {
    const result = validateBackup(makeV2Backup());
    expect(result.ok).toBe(true);
  });

  it("rejects v1 backup with UNSUPPORTED_FORMAT", () => {
    const v1 = {
      format: "timedata.backup.v1",
      exportedAt: NOW_V9,
      appVersion: "0.9.0",
      device: { deviceId: null, deviceName: "Web" },
      categories: [],
      timeEntries: [],
    };
    const result = validateBackup(v1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected");
    expect(result.error.code).toBe("UNSUPPORTED_FORMAT");
  });
});
