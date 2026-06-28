import { describe, expect, it } from "vitest";

import { encodeGoalLayoutPinKey } from "./goalLayoutPins.js";
import {
  CategorySchema,
  QuickNoteSchema,
  SettingSchema,
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

const quickNote = {
  id: "note-1",
  text: "突然想到一个词",
  occurredAt: "2026-06-01T04:01:30.123Z",
  createdAt: "2026-06-01T04:02:00.000Z",
  updatedAt: "2026-06-01T04:02:00.000Z",
};

const task = {
  id: "task-1",
  title: "跑步",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  completedCount: 0,
  sortOrder: 0,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
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

  it("accepts quick_notes as a synced table", () => {
    expect(
      SyncLogEntrySchema.safeParse({
        id: "log-note-1",
        tableName: "quick_notes",
        recordId: "note-1",
        action: "create",
        timestamp: "2026-06-01T04:02:00.000Z",
        synced: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts tasks as a synced table", () => {
    expect(
      SyncLogEntrySchema.safeParse({
        id: "log-task-1",
        tableName: "tasks",
        recordId: "task-1",
        action: "create",
        timestamp: "2026-06-14T00:00:00.000Z",
        synced: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts tracks and track_steps as synced tables", () => {
    expect(
      SyncLogEntrySchema.safeParse({
        id: "log-track-1",
        tableName: "tracks",
        recordId: "track-1",
        action: "create",
        timestamp: "2026-06-21T00:00:00.000Z",
        synced: 0,
      }).success,
    ).toBe(true);
    expect(
      SyncLogEntrySchema.safeParse({
        id: "log-step-1",
        tableName: "track_steps",
        recordId: "step-1",
        action: "create",
        timestamp: "2026-06-21T00:00:00.000Z",
        synced: 0,
      }).success,
    ).toBe(true);
  });
});

describe("SettingSchema", () => {
  it("接受合法设置，拒绝空 key / 非字符串 value", () => {
    expect(SettingSchema.safeParse({ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" }).success).toBe(true);
    expect(SettingSchema.safeParse({ key: "", value: "x", updatedAt: "2026-05-30T00:00:00.000Z" }).success).toBe(false);
    expect(SettingSchema.safeParse({ key: "k", value: 1, updatedAt: "2026-05-30T00:00:00.000Z" }).success).toBe(false);
  });
});

describe("QuickNoteSchema", () => {
  it("accepts valid quick notes and preserves text whitespace", () => {
    const parsed = QuickNoteSchema.parse({ ...quickNote, text: "  repo  " });

    expect(parsed.text).toBe("  repo  ");
  });

  it("accepts optional source metadata for agent notes", () => {
    const parsed = QuickNoteSchema.parse({ ...quickNote, source: "agent", sourceLabel: "Hermes" });

    expect(parsed.source).toBe("agent");
    expect(parsed.sourceLabel).toBe("Hermes");
  });

  it("keeps source metadata backward compatible for legacy notes", () => {
    const parsed = QuickNoteSchema.parse(quickNote);

    expect(parsed.source).toBeUndefined();
    expect(parsed.sourceLabel).toBeUndefined();
  });

  it("解析 pinned 布尔字段，缺省时为 undefined", () => {
    expect(QuickNoteSchema.parse({ ...quickNote, pinned: true }).pinned).toBe(true);
    expect(QuickNoteSchema.parse(quickNote).pinned).toBeUndefined();
  });

  it("rejects unknown source values", () => {
    expect(QuickNoteSchema.safeParse({ ...quickNote, source: "robot" }).success).toBe(false);
  });

  it("rejects empty text", () => {
    expect(QuickNoteSchema.safeParse({ ...quickNote, text: "   " }).success).toBe(false);
  });

  it("rejects non-UTC ISO timestamps", () => {
    expect(QuickNoteSchema.safeParse({ ...quickNote, occurredAt: "2026-06-01T12:01:30" }).success).toBe(false);
    expect(QuickNoteSchema.safeParse({ ...quickNote, createdAt: "2026-06-01T12:02:00Z" }).success).toBe(false);
    expect(QuickNoteSchema.safeParse({ ...quickNote, updatedAt: "2026-06-01T12:02:00Z" }).success).toBe(false);
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

  it("rejects non-finite or non-integer sync cursors and counts", () => {
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: -1 }).success).toBe(false);
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: 1.5 }).success).toBe(false);
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: Number.POSITIVE_INFINITY }).success).toBe(false);

    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: -1,
      entryCount: 0,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      serverTime: "2026-05-13T00:00:00.000Z",
    }).success).toBe(false);
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0,
      entryCount: 1.5,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      serverTime: "2026-05-13T00:00:00.000Z",
    }).success).toBe(false);
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0,
      entryCount: Number.POSITIVE_INFINITY,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      serverTime: "2026-05-13T00:00:00.000Z",
    }).success).toBe(false);
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0,
      entryCount: 0,
      quickNoteCount: -1,
      lastUpdatedAt: null,
      serverTime: "2026-05-13T00:00:00.000Z",
    }).success).toBe(false);
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0,
      entryCount: 0,
      quickNoteCount: 0,
      lastUpdatedAt: null,
      latestSeq: -1,
      serverTime: "2026-05-13T00:00:00.000Z",
    }).success).toBe(false);
    expect(SyncPullResponseSchema.safeParse({
      changes: [],
      serverTime: "2026-05-13T00:00:00.000Z",
      latestSeq: 1.5,
    }).success).toBe(false);
  });

  it("validates sync pull and force-push request payloads", () => {
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: 0, lastSyncedAt: null }).success).toBe(true);
    expect(SyncPullRequestSchema.safeParse({ sinceSeq: "not-a-number" }).success).toBe(false);
    expect(
      SyncForcePushPrepareRequestSchema.safeParse({
        categoryCount: 1,
        entryCount: 0,
        quickNoteCount: 1,
        lastUpdatedAt: "2026-05-13T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      SyncForcePushPrepareRequestSchema.safeParse({
        categoryCount: -1,
        entryCount: 0,
        quickNoteCount: 0,
        lastUpdatedAt: null,
      }).success,
    ).toBe(false);
    expect(
      SyncForcePushRequestSchema.safeParse({
        confirmToken: "token",
        confirmationPhrase: "WRONG",
        categories: [],
        timeEntries: [],
        quickNotes: [],
      }).success,
    ).toBe(false);
    const parsedForcePush = SyncForcePushRequestSchema.parse({
      confirmToken: "token",
      confirmationPhrase: "OVERWRITE_SERVER",
      categories: [],
      timeEntries: [],
      quickNotes: [],
      tasks: [task],
    });
    const legacyStateField = "tu" + "rn";
    const legacyStateTimeField = `${legacyStateField}At`;
    expect(parsedForcePush.tasks).toEqual([{ ...task, parentId: null, completedAt: null, tags: [], weight: 0 }]);
    expect(Object.hasOwn(parsedForcePush.tasks[0] ?? {}, legacyStateField)).toBe(false);
    expect(Object.hasOwn(parsedForcePush.tasks[0] ?? {}, legacyStateTimeField)).toBe(false);
    expect(
      SyncForcePushRequestSchema.parse({
        confirmToken: "token",
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }).tasks,
    ).toEqual([]);
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

  it("accepts settings upsert and delete changes", () => {
    expect(
      SyncChangeSchema.safeParse({
        tableName: "settings",
        recordId: "sleep.categoryId",
        action: "update",
        data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
        timestamp: "2026-05-30T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      SyncChangeSchema.safeParse({
        tableName: "settings",
        recordId: "sleep.categoryId",
        action: "delete",
        data: null,
        timestamp: "2026-05-30T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts quick note upsert and delete changes", () => {
    expect(
      SyncChangeSchema.safeParse({
        tableName: "quick_notes",
        recordId: "note-1",
        action: "create",
        data: quickNote,
        timestamp: "2026-06-01T04:02:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      SyncChangeSchema.safeParse({
        tableName: "quick_notes",
        recordId: "note-1",
        action: "delete",
        data: null,
        timestamp: "2026-06-01T04:03:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects quick note upserts without valid quick note data", () => {
    expect(
      SyncChangeSchema.safeParse({
        tableName: "quick_notes",
        recordId: "note-1",
        action: "update",
        data: { ...quickNote, text: "   " },
        timestamp: "2026-06-01T04:02:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts goals as a synced table", () => {
    const parsed = SyncChangeSchema.parse({
      tableName: "goals",
      recordId: "goal-1",
      action: "create",
      timestamp: "2026-06-22T01:00:00.000Z",
      data: {
        id: "goal-1",
        title: "发布 v2",
        kind: "project",
        status: "active",
        members: [{ kind: "task", id: "task-1" }],
        prerequisites: [],
        createdAt: "2026-06-22T01:00:00.000Z",
        updatedAt: "2026-06-22T01:00:00.000Z",
      },
    });
    expect(parsed.tableName).toBe("goals");
    expect(parsed.data).toMatchObject({ members: [{ kind: "task", id: "task-1" }] });
  });

  it("accepts goal_layout_pins as a synced table", () => {
    const now = "2026-06-24T00:00:00.000Z";
    const data = { goalId: "goal-1", nodeKind: "goal" as const, nodeId: "goal-1", x: 100, y: -50, updatedAt: now };
    const recordId = encodeGoalLayoutPinKey(data.goalId, data.nodeKind, data.nodeId);
    const parsed = SyncChangeSchema.parse({
      tableName: "goal_layout_pins",
      recordId,
      action: "create",
      timestamp: now,
      data,
    });

    expect(parsed.tableName).toBe("goal_layout_pins");
    expect(
      SyncLogEntrySchema.safeParse({
        id: "log-pin-1",
        tableName: "goal_layout_pins",
        recordId,
        action: "create",
        timestamp: now,
        synced: 0,
      }).success,
    ).toBe(true);
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
      categoryCount: 0, entryCount: 0, quickNoteCount: 0,
      lastUpdatedAt: "2026-05-19T03:00:00Z",
      serverTime: "2026-05-19T03:00:00Z",
    }).success).toBe(false);
  });

  it("合法 .sssZ 格式应通过", () => {
    expect(SyncStatusResponseSchema.safeParse({
      categoryCount: 0, entryCount: 0, quickNoteCount: 0,
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
