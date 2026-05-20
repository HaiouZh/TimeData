// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Category, TimeEntry } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AutoBackupRecord, db } from "../db/index.js";

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: vi.fn(() => []),
}));
import { CATEGORY_COLOR_PALETTES } from "../lib/categoryColors.js";
import {
  addCategory,
  applyCategoryPalette,
  archiveCategory,
  deleteCategory,
  getCategoryDeleteImpact,
  persistCategoryOrder,
  renameCategory,
  updateCategoryColor,
  useCategories,
} from "./useCategories.js";

function category(id: string, parentId: string | null, sortOrder: number): Category;
function category(overrides: Partial<Category> & { id: string }): Category;
function category(
  idOrOverrides: string | (Partial<Category> & { id: string }),
  parentId?: string | null,
  sortOrder?: number,
): Category {
  const overrides =
    typeof idOrOverrides === "string"
      ? { id: idOrOverrides, name: idOrOverrides, parentId: parentId ?? null, sortOrder: sortOrder ?? 0 }
      : idOrOverrides;
  return {
    color: "#4A90D9",
    icon: null,
    isArchived: false,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides,
  };
}

function entry(id: string, categoryId: string): TimeEntry {
  return {
    id,
    categoryId,
    startTime: `2026-05-08T0${id.endsWith("1") ? "8" : "9"}:00:00`,
    endTime: `2026-05-08T0${id.endsWith("1") ? "9" : "10"}:00:00`,
    note: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type UpdateCategory = ReturnType<typeof useCategories>["updateCategory"];

async function captureUpdateCategory(): Promise<UpdateCategory> {
  let updateCategory: UpdateCategory | null = null;
  const host = document.createElement("div");
  const root = createRoot(host);

  function Probe() {
    updateCategory = useCategories().updateCategory;
    return null;
  }

  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    root.unmount();
  });

  if (!updateCategory) throw new Error("updateCategory not captured");
  return updateCategory;
}

beforeEach(async () => {
  await db.categories.clear();
  await db.timeEntries.clear();
  await db.syncLog.clear();
  await db.autoBackups.clear();
});

describe("addCategory", () => {
  it("rejects blank category names", async () => {
    await expect(addCategory("   ", null, "#4A90D9")).rejects.toThrow("分类名称不能为空");

    await expect(db.categories.toArray()).resolves.toHaveLength(0);
  });

  it("rejects duplicate category names within the same parent", async () => {
    await db.categories.add(category({ id: "parent", name: "工作", parentId: null }));

    await expect(addCategory(" 工作 ", null, "#4A90D9")).rejects.toThrow("同层级已存在同名分类");
  });

  it("allows the same category name under a different parent", async () => {
    await db.categories.bulkAdd([
      category({ id: "parent-a", name: "A", parentId: null }),
      category({ id: "parent-b", name: "B", parentId: null }),
      category({ id: "child-a", name: "阅读", parentId: "parent-a" }),
    ]);

    await expect(addCategory("阅读", "parent-b", "#4A90D9")).resolves.toBeDefined();
  });

  it("trims names and writes a create sync log", async () => {
    const saved = await addCategory(" 工作 ", null, "#4A90D9");

    expect(saved.name).toBe("工作");
    await expect(db.categories.get(saved.id)).resolves.toMatchObject({ name: "工作" });
    await expect(db.syncLog.toArray()).resolves.toEqual([
      expect.objectContaining({ tableName: "categories", recordId: saved.id, action: "create", synced: 0 }),
    ]);
  });

  it("rolls back the category when sync log creation fails", async () => {
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("sync log failed"));

    await expect(addCategory("工作", null, "#4A90D9")).rejects.toThrow("sync log failed");

    await expect(db.categories.toArray()).resolves.toHaveLength(0);
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });

  it("allows reusing the name of an archived sibling", async () => {
    await db.categories.add(category({ id: "old", name: "工作", parentId: null, isArchived: true }));

    await expect(addCategory("工作", null, "#4A90D9")).resolves.toBeDefined();
  });
});

describe("persistCategoryOrder", () => {
  it("persists top-level sortOrder and writes one sync log for each changed category", async () => {
    await db.categories.bulkAdd([
      category("sleep", null, 0),
      category("work", null, 1),
      category("play", null, 2),
      category("sleep-a", "sleep", 0),
    ]);

    await persistCategoryOrder(null, ["play", "sleep", "work"]);

    await expect(
      db.categories
        .orderBy("sortOrder")
        .filter((item) => item.parentId === null)
        .toArray(),
    ).resolves.toMatchObject([
      { id: "play", sortOrder: 0 },
      { id: "sleep", sortOrder: 1 },
      { id: "work", sortOrder: 2 },
    ]);
    await expect(db.categories.get("sleep-a")).resolves.toMatchObject({ sortOrder: 0 });
    await expect(db.syncLog.where("tableName").equals("categories").count()).resolves.toBe(3);
  });

  it("updates auto backup sortOrder for reordered categories only", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [category("sleep", null, 0), category("work", null, 1), category("play", null, 2)],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);

    await persistCategoryOrder(null, ["play", "sleep", "work"]);

    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "sleep", sortOrder: 1 },
        { id: "work", sortOrder: 2 },
        { id: "play", sortOrder: 0 },
      ],
    });
  });

  it("persists child sortOrder only under the requested parent", async () => {
    await db.categories.bulkAdd([
      category("sleep", null, 0),
      category("work", null, 1),
      category("sleep-a", "sleep", 0),
      category("sleep-b", "sleep", 1),
      category("work-a", "work", 0),
    ]);

    await persistCategoryOrder("sleep", ["sleep-b", "sleep-a"]);

    await expect(db.categories.where("parentId").equals("sleep").sortBy("sortOrder")).resolves.toMatchObject([
      { id: "sleep-b", sortOrder: 0 },
      { id: "sleep-a", sortOrder: 1 },
    ]);
    await expect(db.categories.get("work-a")).resolves.toMatchObject({ sortOrder: 0 });
    await expect(db.syncLog.where("tableName").equals("categories").count()).resolves.toBe(2);
  });

  it("does not write sync logs when order is unchanged", async () => {
    await db.categories.bulkAdd([category("sleep", null, 0), category("work", null, 1)]);

    await persistCategoryOrder(null, ["sleep", "work"]);

    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("ignores ordered ids that do not exactly match the current sibling scope", async () => {
    await db.categories.bulkAdd([
      category("sleep", null, 0),
      category("work", null, 1),
      category("sleep-a", "sleep", 0),
    ]);

    await persistCategoryOrder(null, ["sleep-a", "sleep"]);

    await expect(
      db.categories
        .orderBy("sortOrder")
        .filter((item) => item.parentId === null)
        .toArray(),
    ).resolves.toMatchObject([
      { id: "sleep", sortOrder: 0 },
      { id: "work", sortOrder: 1 },
    ]);
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
});

describe("deleteCategory", () => {
  it("reports delete impact for a child category", async () => {
    await db.categories.bulkAdd([category("work", null, 0), category("work-code", "work", 0)]);
    await db.timeEntries.bulkAdd([entry("entry-1", "work-code"), entry("entry-2", "work")]);

    await expect(getCategoryDeleteImpact("work-code")).resolves.toEqual({
      categoryIds: ["work-code"],
      childCount: 0,
      entryCount: 1,
    });
  });

  it("reports delete impact for a parent category including direct children", async () => {
    await db.categories.bulkAdd([
      category("work", null, 0),
      category("work-code", "work", 0),
      category("work-docs", "work", 1),
      category("life", null, 1),
    ]);
    await db.timeEntries.bulkAdd([entry("entry-1", "work-code"), entry("entry-2", "work-docs")]);

    await expect(getCategoryDeleteImpact("work")).resolves.toEqual({
      categoryIds: ["work-code", "work-docs", "work"],
      childCount: 2,
      entryCount: 2,
    });
  });

  it("deletes a child category and its time entries with sync logs", async () => {
    await db.categories.bulkAdd([category("work", null, 0), category("work-code", "work", 0)]);
    await db.timeEntries.bulkAdd([entry("entry-1", "work-code"), entry("entry-2", "work")]);

    await deleteCategory("work-code");

    await expect(db.categories.get("work-code")).resolves.toBeUndefined();
    await expect(db.categories.get("work")).resolves.toMatchObject({ id: "work" });
    await expect(db.timeEntries.get("entry-1")).resolves.toBeUndefined();
    await expect(db.timeEntries.get("entry-2")).resolves.toMatchObject({ id: "entry-2" });
    await expect(db.syncLog.orderBy("tableName").toArray()).resolves.toMatchObject([
      { tableName: "categories", recordId: "work-code", action: "delete", synced: 0 },
      { tableName: "time_entries", recordId: "entry-1", action: "delete", synced: 0 },
    ]);
  });

  it("deletes a parent category, descendants, and all affected entries with sync logs", async () => {
    await db.categories.bulkAdd([
      category("work", null, 0),
      category("work-code", "work", 0),
      category("work-code-review", "work-code", 0),
      category("life", null, 1),
    ]);
    await db.timeEntries.bulkAdd([entry("entry-1", "work-code"), entry("entry-2", "work-code-review")]);

    await deleteCategory("work");

    await expect(db.categories.toArray()).resolves.toMatchObject([{ id: "life" }]);
    await expect(db.timeEntries.count()).resolves.toBe(0);
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "categories", recordId: "work-code-review", action: "delete" }),
        expect.objectContaining({ tableName: "categories", recordId: "work-code", action: "delete" }),
        expect.objectContaining({ tableName: "categories", recordId: "work", action: "delete" }),
        expect.objectContaining({ tableName: "time_entries", recordId: "entry-1", action: "delete" }),
        expect.objectContaining({ tableName: "time_entries", recordId: "entry-2", action: "delete" }),
      ]),
    );
  });

  it("reuses the already resolved delete impact when deleting after previewing impact", async () => {
    await db.categories.bulkAdd([category("work", null, 0), category("work-code", "work", 0)]);
    await db.timeEntries.bulkAdd([entry("entry-1", "work-code"), entry("entry-2", "work")]);
    const filterSpy = vi.spyOn(db.timeEntries, "filter");

    await getCategoryDeleteImpact("work");
    await deleteCategory("work");

    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when deleting a missing category", async () => {
    await expect(deleteCategory("missing")).rejects.toThrow("分类不存在。");
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
});

describe("category color mutations", () => {
  it("updates a top-level category color and writes one sync log", async () => {
    await db.categories.bulkAdd([category("work", null, 0), category("work-code", "work", 0)]);

    await updateCategoryColor("work", "#a3b18a");

    await expect(db.categories.get("work")).resolves.toMatchObject({ color: "#A3B18A" });
    await expect(db.categories.get("work-code")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.syncLog.where("recordId").equals("work").toArray()).resolves.toMatchObject([
      { tableName: "categories", recordId: "work", action: "update", synced: 0 },
    ]);
    await expect(db.syncLog.count()).resolves.toBe(1);
  });

  it("updates auto backup color for the same category id", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [category("work", null, 0), category("other", null, 1)],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);

    await updateCategoryColor("work", "#a3b18a");

    const saved = await db.categories.get("work");
    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "work", color: "#A3B18A", updatedAt: saved?.updatedAt },
        { id: "other", color: "#4A90D9", updatedAt: "2026-05-08T00:00:00.000Z" },
      ],
    });
  });

  it("rejects child category color updates", async () => {
    await db.categories.bulkAdd([category("work", null, 0), category("work-code", "work", 0)]);

    await expect(updateCategoryColor("work-code", "#A3B18A")).rejects.toThrow("子分类颜色跟随父分类，不单独改色。");
    await expect(db.categories.get("work-code")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("rejects invalid category colors", async () => {
    await db.categories.add(category("work", null, 0));

    await expect(updateCategoryColor("work", "blue")).rejects.toThrow("颜色格式不正确。");
    await expect(db.categories.get("work")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("does not write a sync log when the color is unchanged", async () => {
    await db.categories.add(category("work", null, 0));

    await updateCategoryColor("work", "#4A90D9");

    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("applies a palette to active top-level categories only", async () => {
    await db.categories.bulkAdd([
      category("life", null, 0),
      category("work", null, 1),
      category("work-code", "work", 0),
      { ...category("old", null, 2), isArchived: true },
    ]);

    await applyCategoryPalette("morandi");

    const colors = CATEGORY_COLOR_PALETTES.morandi.colors;
    await expect(db.categories.get("life")).resolves.toMatchObject({ color: colors[0] });
    await expect(db.categories.get("work")).resolves.toMatchObject({ color: colors[1] });
    await expect(db.categories.get("work-code")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.categories.get("old")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.syncLog.where("tableName").equals("categories").count()).resolves.toBe(2);
  });

  it("updates auto backup colors for palette changes", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [category("life", null, 0), category("work", null, 1), category("work-code", "work", 0)],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);

    await applyCategoryPalette("morandi");

    const colors = CATEGORY_COLOR_PALETTES.morandi.colors;
    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "life", color: colors[0] },
        { id: "work", color: colors[1] },
        { id: "work-code", color: "#4A90D9" },
      ],
    });
  });

  it("writes sync logs only for palette colors that changed", async () => {
    await db.categories.bulkAdd([
      { ...category("life", null, 0), color: CATEGORY_COLOR_PALETTES.classic.colors[0] },
      category("work", null, 1),
      category("work-code", "work", 0),
    ]);

    await applyCategoryPalette("classic");

    await expect(db.categories.get("life")).resolves.toMatchObject({
      color: CATEGORY_COLOR_PALETTES.classic.colors[0],
    });
    await expect(db.categories.get("work")).resolves.toMatchObject({
      color: CATEGORY_COLOR_PALETTES.classic.colors[1],
    });
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "categories", recordId: "work", action: "update", synced: 0 },
    ]);
  });

  it("skips palette updates when top-level colors already match", async () => {
    await db.categories.bulkAdd([
      { ...category("life", null, 0), color: CATEGORY_COLOR_PALETTES.classic.colors[0].toLowerCase() },
      { ...category("work", null, 1), color: CATEGORY_COLOR_PALETTES.classic.colors[1] },
      category("work-code", "work", 0),
    ]);

    await applyCategoryPalette("classic");

    await expect(db.categories.get("life")).resolves.toMatchObject({
      color: CATEGORY_COLOR_PALETTES.classic.colors[0].toLowerCase(),
    });
    await expect(db.categories.get("work")).resolves.toMatchObject({
      color: CATEGORY_COLOR_PALETTES.classic.colors[1],
    });
    await expect(db.categories.get("work-code")).resolves.toMatchObject({ color: "#4A90D9" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
});

describe("archiveCategory", () => {
  it("writes an update sync log when archiving a category", async () => {
    await db.categories.add(category("sleep", null, 0));

    await archiveCategory("sleep");

    await expect(db.categories.get("sleep")).resolves.toMatchObject({
      id: "sleep",
      isArchived: true,
    });
    await expect(db.syncLog.where("recordId").equals("sleep").toArray()).resolves.toMatchObject([
      {
        tableName: "categories",
        recordId: "sleep",
        action: "update",
        synced: 0,
      },
    ]);
  });

  it("updates auto backup archive state for the same category id", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [category("sleep", null, 0), category("other", null, 1)],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);

    await archiveCategory("sleep");

    const saved = await db.categories.get("sleep");
    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "sleep", isArchived: true, updatedAt: saved?.updatedAt },
        { id: "other", isArchived: false, updatedAt: "2026-05-08T00:00:00.000Z" },
      ],
    });
  });

  it("rolls back archived category when sync log creation fails", async () => {
    await db.categories.add(category("sleep", null, 0));
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("sync log failed"));

    await expect(archiveCategory("sleep")).rejects.toThrow("sync log failed");

    await expect(db.categories.get("sleep")).resolves.toMatchObject({
      isArchived: false,
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });
});

describe("updateCategory", () => {
  it("updates managed auto backup categories for the same id", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [
        { ...category("sleep", null, 0), name: "睡眠" },
        { ...category("work", null, 1), name: "工作" },
      ],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);
    const updateCategory = await captureUpdateCategory();

    await updateCategory("sleep", { name: "休息", color: "#a3b18a", icon: "moon", sortOrder: 3 });

    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "sleep", name: "休息", color: "#A3B18A", icon: "moon", sortOrder: 3 },
        { id: "work", name: "工作" },
      ],
    });
  });
});

describe("renameCategory", () => {
  it("renames a category, updates updatedAt, and writes one sync log", async () => {
    await db.categories.bulkAdd([category("sleep", null, 0), category("work", null, 1)]);

    await renameCategory("sleep", "休息");

    await expect(db.categories.get("sleep")).resolves.toMatchObject({
      id: "sleep",
      name: "休息",
    });
    await expect(db.categories.get("sleep")).resolves.not.toMatchObject({
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    await expect(db.syncLog.where("recordId").equals("sleep").toArray()).resolves.toMatchObject([
      {
        tableName: "categories",
        recordId: "sleep",
        action: "update",
        synced: 0,
      },
    ]);
  });

  it("rejects a blank category name", async () => {
    await db.categories.add(category("sleep", null, 0));

    await expect(renameCategory("sleep", "   ")).rejects.toThrow("分类名称不能为空。");

    await expect(db.categories.get("sleep")).resolves.toMatchObject({ name: "sleep" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("rejects duplicate active sibling names", async () => {
    await db.categories.bulkAdd([
      { ...category("sleep", null, 0), name: "睡眠" },
      { ...category("work", null, 1), name: "工作" },
    ]);

    await expect(renameCategory("sleep", "工作")).rejects.toThrow("同一层级下已存在同名分类。");

    await expect(db.categories.get("sleep")).resolves.toMatchObject({ name: "睡眠" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("allows the same child name under different parents", async () => {
    await db.categories.bulkAdd([
      { ...category("life", null, 0), name: "生活" },
      { ...category("work", null, 1), name: "工作" },
      { ...category("life-read", "life", 0), name: "阅读" },
      { ...category("work-read", "work", 0), name: "文档" },
    ]);

    await renameCategory("work-read", "阅读");

    await expect(db.categories.get("work-read")).resolves.toMatchObject({ name: "阅读" });
    await expect(db.syncLog.where("recordId").equals("work-read").count()).resolves.toBe(1);
  });

  it("updates managed auto backup category names for the same id", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [
        { ...category("sleep", null, 0), name: "睡眠" },
        { ...category("work", null, 1), name: "工作" },
      ],
      timeEntries: [],
    };
    await db.categories.bulkAdd(backup.categories);
    await db.autoBackups.add(backup);

    await renameCategory("sleep", "休息");

    await expect(db.autoBackups.get("backup-1")).resolves.toMatchObject({
      categories: [
        { id: "sleep", name: "休息" },
        { id: "work", name: "工作" },
      ],
    });
  });

  it("leaves auto backups without the renamed category unchanged", async () => {
    const backup: AutoBackupRecord = {
      id: "backup-1",
      createdAt: "2026-05-08T01:00:00.000Z",
      categories: [{ ...category("work", null, 0), name: "工作" }],
      timeEntries: [],
    };
    await db.categories.bulkAdd([category("sleep", null, 0), backup.categories[0]]);
    await db.autoBackups.add(backup);

    await renameCategory("sleep", "休息");

    await expect(db.autoBackups.get("backup-1")).resolves.toEqual(backup);
  });
});
