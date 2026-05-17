import { describe, expect, it } from "vitest";
import type { SyncChange } from "@timedata/shared";
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

});
