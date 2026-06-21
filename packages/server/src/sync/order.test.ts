import type { SyncChange } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { orderPushChanges } from "./order.js";

describe("orderPushChanges", () => {
  it("orders category upserts so parents are applied before children", () => {
    const child: SyncChange = {
      tableName: "categories",
      recordId: "child",
      action: "create",
      data: {
        id: "child",
        name: "子分类",
        parentId: "parent",
        color: "#22c55e",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-17T00:00:01.000Z",
        updatedAt: "2026-05-17T00:00:01.000Z",
      },
      timestamp: "2026-05-17T00:00:01.000Z",
    };
    const parent: SyncChange = {
      tableName: "categories",
      recordId: "parent",
      action: "create",
      data: {
        id: "parent",
        name: "父分类",
        parentId: null,
        color: "#22c55e",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
      timestamp: "2026-05-17T00:00:00.000Z",
    };

    expect(orderPushChanges([child, parent]).map((change) => change.recordId)).toEqual(["parent", "child"]);
  });

  it("keeps quick notes independent from category dependency ordering", () => {
    const quickNote: SyncChange = {
      tableName: "quick_notes",
      recordId: "note-1",
      action: "create",
      data: {
        id: "note-1",
        text: "repo",
        occurredAt: "2026-06-01T04:01:30.123Z",
        createdAt: "2026-06-01T04:02:00.000Z",
        updatedAt: "2026-06-01T04:02:00.000Z",
      },
      timestamp: "2026-06-01T04:02:00.000Z",
    };
    const categoryDelete: SyncChange = {
      tableName: "categories",
      recordId: "cat-1",
      action: "delete",
      data: null,
      timestamp: "2026-06-01T04:03:00.000Z",
    };

    expect(orderPushChanges([categoryDelete, quickNote]).map((change) => change.tableName)).toEqual([
      "quick_notes",
      "categories",
    ]);
  });

  it("orders track upserts before track_steps and deletes track_steps before tracks", () => {
    const now = "2026-06-21T00:00:00.000Z";
    const track: SyncChange = {
      tableName: "tracks",
      recordId: "track-1",
      action: "create",
      timestamp: now,
      data: { id: "track-1", title: "T1", status: "active", refs: [], createdAt: now, updatedAt: now },
    };
    const step: SyncChange = {
      tableName: "track_steps",
      recordId: "step-1",
      action: "create",
      timestamp: now,
      data: {
        id: "step-1",
        trackId: "track-1",
        source: "agent",
        content: "",
        startedAt: now,
        endedAt: null,
        refs: [],
        tags: [],
        seq: 0,
        createdAt: now,
        updatedAt: now,
      },
    };
    const trackDelete: SyncChange = { tableName: "tracks", recordId: "track-1", action: "delete", data: null, timestamp: now };
    const stepDelete: SyncChange = {
      tableName: "track_steps",
      recordId: "step-1",
      action: "delete",
      data: null,
      timestamp: now,
    };

    expect(orderPushChanges([step, track]).map((change) => change.tableName)).toEqual(["tracks", "track_steps"]);
    expect(orderPushChanges([trackDelete, stepDelete]).map((change) => change.tableName)).toEqual([
      "track_steps",
      "tracks",
    ]);
  });
});
