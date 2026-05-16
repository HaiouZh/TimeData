import { describe, expect, it } from "vitest";
import type { SyncChange } from "@timedata/shared";
import { orderPushChanges } from "./order.js";

describe("orderPushChanges", () => {
  it("applies category changes before time entries", () => {
    const entry: SyncChange = {
      tableName: "time_entries",
      recordId: "entry-1",
      action: "create",
      data: null,
      timestamp: "2026-05-05T00:00:00.000Z",
    };
    const category: SyncChange = {
      tableName: "categories",
      recordId: "category-1",
      action: "create",
      data: null,
      timestamp: "2026-05-05T00:00:00.000Z",
    };

    expect(orderPushChanges([entry, category])).toEqual([category, entry]);
  });
});
