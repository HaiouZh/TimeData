import { describe, expect, it } from "vitest";

import { SyncChangeSchema } from "./schemas.js";

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
