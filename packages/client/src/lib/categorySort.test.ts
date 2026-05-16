import { describe, expect, it } from "vitest";
import type { Category } from "@timedata/shared";
import { changedCategorySortOrders, reorderCategoriesWithinParent } from "./categorySort.js";

function category(id: string, parentId: string | null, sortOrder: number): Category {
  return {
    id,
    name: id,
    parentId,
    color: "#4A90D9",
    icon: null,
    sortOrder,
    isArchived: false,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  };
}

describe("reorderCategoriesWithinParent", () => {
  it("reorders top-level categories and rewrites sortOrder from zero", () => {
    const result = reorderCategoriesWithinParent(
      [category("sleep", null, 0), category("work", null, 1), category("play", null, 2)],
      "play",
      "sleep",
      null
    );

    expect(result.map((item) => [item.id, item.sortOrder])).toEqual([
      ["play", 0],
      ["sleep", 1],
      ["work", 2],
    ]);
  });

  it("reorders only children under the requested parent", () => {
    const result = reorderCategoriesWithinParent(
      [
        category("sleep", null, 0),
        category("sleep-a", "sleep", 0),
        category("sleep-b", "sleep", 1),
        category("work-a", "work", 0),
      ],
      "sleep-b",
      "sleep-a",
      "sleep"
    );

    expect(result.map((item) => [item.id, item.parentId, item.sortOrder])).toEqual([
      ["sleep-b", "sleep", 0],
      ["sleep-a", "sleep", 1],
    ]);
  });

  it("returns the current sibling order when active or over is outside the parent scope", () => {
    const result = reorderCategoriesWithinParent(
      [category("sleep-a", "sleep", 0), category("work-a", "work", 0)],
      "sleep-a",
      "work-a",
      "sleep"
    );

    expect(result.map((item) => [item.id, item.sortOrder])).toEqual([["sleep-a", 0]]);
  });
});

describe("changedCategorySortOrders", () => {
  it("returns only categories whose sortOrder changed", () => {
    const before = [category("sleep", null, 0), category("work", null, 1), category("play", null, 2)];
    const after = [
      { ...before[2], sortOrder: 0 },
      { ...before[0], sortOrder: 1 },
      { ...before[1], sortOrder: 2 },
    ];

    expect(changedCategorySortOrders(before, after)).toEqual([
      { id: "play", sortOrder: 0 },
      { id: "sleep", sortOrder: 1 },
      { id: "work", sortOrder: 2 },
    ]);
  });

  it("returns an empty list when the visible order did not change", () => {
    const before = [category("sleep", null, 0), category("work", null, 1)];

    expect(changedCategorySortOrders(before, before)).toEqual([]);
  });
});
