import { describe, expect, it } from "vitest";

import {
  CategorySchema,
  SyncChangeSchema,
  SyncForcePushPrepareRequestSchema,
  SyncForcePushRequestSchema,
  SyncLogEntrySchema,
  SyncPullRequestSchema,
  SyncPullResponseSchema,
  SyncStatusResponseSchema,
  TimeEntrySchema,
  UtcIsoStringSchema,
} from "./schemas.js";

const category = {
  id: "c1",
  name: "工作",
  parentId: null,
  color: "#000000",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
};

const timeEntry = {
  id: "e1",
  categoryId: "c1",
  startTime: "2026-05-13T10:00:00.000Z",
  endTime: "2026-05-13T11:00:00.000Z",
  note: null,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
};

describe("SyncLogEntrySchema", () => {
  it("only accepts synced as 0 or 1", () => {
    const base = {
      id: "log-1",
      tableName: "categories" as const,
      recordId: "c1",
      action: "update" as const,
      timestamp: "2026-05-13T00:00:00.000Z",
    };

    expect(SyncLogEntrySchema.safeParse({ ...base, synced: 0 }).success).toBe(true);
    expect(SyncLogEntrySchema.safeParse({ ...base, synced: 1 }).success).toBe(true);
    expect(SyncLogEntrySchema.safeParse({ ...base, synced: true }).success).toBe(false);
    expect(SyncLogEntrySchema.safeParse({ ...base, synced: false }).success).toBe(false);
  });
});

describe("runtime schemas", () => {
  it("rejects categories with invalid colors or non-integer sortOrder", () => {
    expect(CategorySchema.safeParse({ ...category, color: "blue" }).success).toBe(false);
    expect(CategorySchema.safeParse({ ...category, sortOrder: 1.5 }).success).toBe(false);
  });

  it("rejects time entries with non-UTC times or invalid ranges", () => {
    expect(
      TimeEntrySchema.safeParse({
        ...timeEntry,
        startTime: "2026-05-17T09:00:00",
        endTime: "2026-05-17T10:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      TimeEntrySchema.safeParse({
        ...timeEntry,
        startTime: "2026-05-17T10:00:00.000Z",
        endTime: "2026-05-17T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("preserves accepted string values while rejecting whitespace-only identifiers", () => {
    expect(CategorySchema.safeParse({ ...category, id: "   " }).success).toBe(false);

    const parsed = CategorySchema.parse({ ...category, name: " 工作 " });

    expect(parsed.name).toBe(" 工作 ");
  });

  it("validates sync pull and force-push request payloads", () => {
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: 0, lastSyncedAt: null }).success).toBe(true);
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: "not-a-number" }).success).toBe(false);
    expect(
      SyncForcePushPrepareRequestSchema.safeParse({
        categoryCount: 1,
        entryCount: 0,
        lastUpdatedAt: "2026-05-13T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      SyncForcePushPrepareRequestSchema.safeParse({ categoryCount: -1, entryCount: 0, lastUpdatedAt: null }).success,
    ).toBe(false);
    expect(
      SyncForcePushRequestSchema.safeParse({
        confirmToken: "token",
        confirmationPhrase: "WRONG",
        categories: [],
        timeEntries: [],
      }).success,
    ).toBe(false);
  });
});

describe("SyncChangeSchema", () => {
  it("accepts valid category create changes", () => {
    expect(
      SyncChangeSchema.parse({
        tableName: "categories",
        action: "create",
        recordId: "c1",
        timestamp: "2026-05-13T00:00:00.000Z",
        data: category,
      }),
    ).toBeDefined();
  });

  it("rejects create changes without data", () => {
    expect(() =>
      SyncChangeSchema.parse({
        tableName: "categories",
        action: "create",
        recordId: "c1",
        timestamp: "2026-05-13T00:00:00.000Z",
        data: null,
      }),
    ).toThrow();
  });

  it("requires null data for delete changes", () => {
    expect(
      SyncChangeSchema.parse({
        tableName: "categories",
        action: "delete",
        recordId: "c1",
        timestamp: "2026-05-13T00:00:00.000Z",
        data: null,
      }),
    ).toBeDefined();

    expect(() =>
      SyncChangeSchema.parse({
        tableName: "categories",
        action: "delete",
        recordId: "c1",
        timestamp: "2026-05-13T00:00:00.000Z",
        data: category,
      }),
    ).toThrow();
  });
});

describe("SyncLogEntrySchema.timestamp (收紧前先验证现状)", () => {
  it("现行 server 返回的 .sssZ ISO 字符串能通过 UtcIsoStringSchema", () => {
    const sample = "2026-05-19T03:21:00.000Z";
    expect(UtcIsoStringSchema.safeParse(sample).success).toBe(true);
    expect(SyncLogEntrySchema.safeParse({
      id: "1", tableName: "categories", recordId: "c1",
      action: "create", timestamp: sample, synced: 1,
    }).success).toBe(true);
  });

  it("不带毫秒的 ISO 字符串收紧后应被拒绝", () => {
    const sample = "2026-05-19T03:21:00Z";
    expect(UtcIsoStringSchema.safeParse(sample).success).toBe(false);
    expect(SyncLogEntrySchema.safeParse({
      id: "1", tableName: "categories", recordId: "c1",
      action: "create", timestamp: sample, synced: 1,
    }).success).toBe(false);
  });
});

describe("SyncStatusResponseSchema / SyncPullResponseSchema serverTime 收紧", () => {
  it("非 .sssZ 格式应被拒绝", () => {
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0, entryCount: 0,
      lastUpdatedAt: "2026-05-19T03:00:00Z",
      serverTime: "2026-05-19T03:00:00Z",
    }).success).toBe(false);
  });

  it("合法 .sssZ 格式应通过", () => {
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0, entryCount: 0,
      lastUpdatedAt: "2026-05-19T03:00:00.000Z",
      serverTime: "2026-05-19T03:00:00.000Z",
    }).success).toBe(true);
  });

  it("SyncPullResponseSchema serverTime 非 .sssZ 应被拒绝", () => {
    expect(SyncPullResponseSchema.safeParse({
      changes: [],
      serverTime: "2026-05-19T03:00:00Z",
    }).success).toBe(false);
  });
});
