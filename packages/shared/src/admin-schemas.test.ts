import { describe, expect, it } from "vitest";

import {
  AdminAnalyticsResponseSchema,
  AdminBackupRetentionSchema,
  AdminBackupsResponseSchema,
  AdminBackupConfigResponseSchema,
  AdminEntriesResponseSchema,
  AdminEntryAnomalySchema,
  AdminEntryRowSchema,
  AdminHealthChecksResponseSchema,
  AdminRequestLogsResponseSchema,
  AdminRunDailyResponseSchema,
  BackupConfigSchema,
  AdminSummaryResponseSchema,
} from "./admin-schemas.js";

describe("AdminEntryAnomalySchema", () => {
  it("accepts legal enum values", () => {
    expect(AdminEntryAnomalySchema.safeParse("invalid_time_range").success).toBe(true);
    expect(AdminEntryAnomalySchema.safeParse("missing_category").success).toBe(true);
    expect(AdminEntryAnomalySchema.safeParse("archived_category").success).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(AdminEntryAnomalySchema.safeParse("definitely_not_real").success).toBe(false);
  });
});

describe("AdminBackupRetentionSchema", () => {
  it("accepts legal enum values", () => {
    expect(AdminBackupRetentionSchema.safeParse("recent").success).toBe(true);
    expect(AdminBackupRetentionSchema.safeParse("protected").success).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(AdminBackupRetentionSchema.safeParse("auto").success).toBe(false);
  });
});

describe("BackupConfigSchema", () => {
  it("accepts backup config and run-daily response payloads", () => {
    const config = { dailyBackup: { enabled: true, timeOfDay: "04:00" }, retentionDays: 7 };

    expect(BackupConfigSchema.safeParse(config).success).toBe(true);
    expect(AdminBackupConfigResponseSchema.safeParse({ config }).success).toBe(true);
    expect(AdminRunDailyResponseSchema.safeParse({ created: true, backupId: "b1", reason: "created" }).success).toBe(
      true,
    );
  });

  it("rejects invalid backup config", () => {
    expect(
      BackupConfigSchema.safeParse({ dailyBackup: { enabled: true, timeOfDay: "9pm" }, retentionDays: 0 }).success,
    ).toBe(false);
  });
});

describe("AdminEntryRowSchema", () => {
  it("accepts a complete row payload", () => {
    expect(AdminEntryRowSchema.safeParse({
      id: "entry-1",
      categoryId: "cat-1",
      categoryName: "工作",
      parentCategoryName: null,
      startTime: "2026-05-19T01:00:00.000Z",
      endTime: "2026-05-19T02:00:00.000Z",
      durationMinutes: 60,
      note: null,
      createdAt: "2026-05-19T01:00:00.000Z",
      updatedAt: "2026-05-19T01:00:00.000Z",
      anomaly: null,
    }).success).toBe(true);
  });

  it("rejects timestamp fields without milliseconds", () => {
    expect(AdminEntryRowSchema.safeParse({
      id: "entry-1",
      categoryId: "cat-1",
      categoryName: "工作",
      parentCategoryName: null,
      startTime: "2026-05-19T01:00:00Z",
      endTime: "2026-05-19T02:00:00.000Z",
      durationMinutes: 60,
      note: null,
      createdAt: "2026-05-19T01:00:00.000Z",
      updatedAt: "2026-05-19T01:00:00.000Z",
      anomaly: null,
    }).success).toBe(false);
  });
});

describe("admin response schemas", () => {
  it("accepts backups response payloads", () => {
    expect(AdminBackupsResponseSchema.safeParse({
      backups: [{
        id: "backup-1",
        fileName: "sync-2026-05-19T01-00-00-000Z.db",
        operation: "sync",
        sizeBytes: 1024,
        createdAt: "2026-05-19T01:00:00.000Z",
        protected: true,
        reason: "local-wins",
        retention: "protected",
        relatedSyncLogId: 1,
      }],
    }).success).toBe(true);
  });

  it("accepts health checks response payloads", () => {
    expect(AdminHealthChecksResponseSchema.safeParse({
      generatedAt: "2026-05-19T01:00:00.000Z",
      checks: [{
        code: "overlap",
        severity: "warning",
        count: 1,
        sampleIds: ["entry-1"],
      }],
    }).success).toBe(true);
  });

  it("accepts analytics response payloads", () => {
    expect(AdminAnalyticsResponseSchema.safeParse({
      range: { from: null, to: null, groupBy: "day" },
      byTime: [{ bucket: "2026-05-19", totalMinutes: 60, entryCount: 1 }],
      byCategory: [{
        categoryId: "cat-1",
        categoryName: "工作",
        parentCategoryName: null,
        totalMinutes: 60,
        entryCount: 1,
        color: "#3366ff",
      }],
    }).success).toBe(true);
  });

  it("accepts request log response payloads", () => {
    expect(AdminRequestLogsResponseSchema.parse({
      logs: [{
        id: 1,
        timestamp: "2026-06-25T00:00:00.000Z",
        method: "GET",
        path: "/api/tasks",
        status: 200,
        outcome: "ok",
        tokenTier: "master",
        ip: "127.0.0.1",
        userAgent: "Vitest",
        clientHint: "web",
        deviceLabel: "web",
        durationMs: 12,
      }],
      limit: 100,
    })).toMatchObject({ logs: [{ outcome: "ok", tokenTier: "master" }] });
  });

  it("rejects non-finite or non-integer counts and empty backup identifiers", () => {
    expect(AdminSummaryResponseSchema.safeParse({
      generatedAt: "2026-05-19T01:00:00.000Z",
      counts: {
        categories: 1.5,
        activeCategories: 1,
        archivedCategories: 0,
        timeEntries: 1,
        syncLogs: 1,
        tombstones: 0,
        serverBackups: 0,
      },
      latest: {
        entryUpdatedAt: null,
        syncLogTimestamp: null,
        backupCreatedAt: null,
      },
    }).success).toBe(false);

    expect(AdminEntriesResponseSchema.safeParse({ entries: [], limit: -1, offset: 0, total: 0 }).success).toBe(false);
    expect(AdminEntriesResponseSchema.safeParse({ entries: [], limit: 10, offset: 0.5, total: 0 }).success).toBe(false);
    expect(AdminEntriesResponseSchema.safeParse({
      entries: [],
      limit: 10,
      offset: 0,
      total: Number.POSITIVE_INFINITY,
    }).success).toBe(false);

    expect(AdminBackupsResponseSchema.safeParse({
      backups: [{
        id: "",
        fileName: "sync-2026-05-19T01-00-00-000Z.db",
        operation: "sync",
        sizeBytes: 1024,
        createdAt: "2026-05-19T01:00:00.000Z",
        protected: true,
        reason: "local-wins",
        retention: "protected",
        relatedSyncLogId: 1,
      }],
    }).success).toBe(false);
    expect(AdminBackupsResponseSchema.safeParse({
      backups: [{
        id: "backup-1",
        fileName: "",
        operation: "sync",
        sizeBytes: -1,
        createdAt: "2026-05-19T01:00:00.000Z",
        protected: true,
        reason: "local-wins",
        retention: "protected",
        relatedSyncLogId: 1,
      }],
    }).success).toBe(false);
  });
});
