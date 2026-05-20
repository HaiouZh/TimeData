import type { Category } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { collectCategoryTreeIds } from "./categoryTree.js";

function category(id: string, parentId: string | null, sortOrder = 0): Category {
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

describe("collectCategoryTreeIds", () => {
  it("returns a single category id when the category has no children", () => {
    expect(collectCategoryTreeIds([category("work", null)], "work")).toEqual(["work"]);
  });

  it("returns descendants before the root for a category tree", () => {
    expect(
      collectCategoryTreeIds(
        [category("work", null), category("code", "work", 1), category("docs", "work", 0), category("deep", "code")],
        "work",
      ),
    ).toEqual(["docs", "deep", "code", "work"]);
  });

  it("returns an empty array when the root id does not exist", () => {
    expect(collectCategoryTreeIds([category("work", null)], "missing")).toEqual([]);
  });
});
