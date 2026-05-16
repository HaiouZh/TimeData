import { describe, expect, it } from "vitest";
import type { Category, TimeEntry } from "@timedata/shared";
import { categoryDependencyChangesForEntry } from "./changes.js";

const now = "2026-05-05T00:00:00.000Z";

describe("categoryDependencyChangesForEntry", () => {
  it("includes parent and child category changes before an entry can be pushed", () => {
    const parent: Category = {
      id: "local-parent",
      name: "本地父分类",
      parentId: null,
      color: "#123456",
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
    const child: Category = {
      id: "local-child",
      name: "本地子分类",
      parentId: "local-parent",
      color: "#123456",
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
    const entry: TimeEntry = {
      id: "entry-1",
      categoryId: "local-child",
      startTime: now,
      endTime: "2026-05-05T01:00:00.000Z",
      note: null,
      createdAt: now,
      updatedAt: now,
    };

    const changes = categoryDependencyChangesForEntry(entry, new Map([[parent.id, parent], [child.id, child]]), now, new Set());

    expect(changes.map((change) => change.recordId)).toEqual(["local-parent", "local-child"]);
    expect(changes.every((change) => change.tableName === "categories")).toBe(true);
  });
});
