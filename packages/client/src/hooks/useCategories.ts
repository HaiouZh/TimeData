import { UNCATEGORIZED_COLOR } from "@timedata/shared";
import type { Category, TimeEntry } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo } from "react";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.ts";
import {
  type CategoryColorPaletteId,
  applyCategoryPaletteByIndex,
  normalizeCategoryColor,
} from "../lib/categoryColors.ts";
import { compareCategoryOrder } from "../lib/categorySort.ts";
import { collectCategoryTreeIds } from "../lib/categoryTree.ts";
import { recordSyncLog } from "../sync/engine.ts";

interface CategorySortUpdate {
  key: string;
  changes: {
    sortOrder: number;
    updatedAt: string;
  };
}

export interface CategoryDeleteImpact {
  categoryIds: string[];
  childCount: number;
  entryCount: number;
}

interface ResolvedCategoryDeleteImpact extends CategoryDeleteImpact {
  entries: TimeEntry[];
}

let pendingDeleteImpact: { id: string; impact: ResolvedCategoryDeleteImpact } | null = null;

function requireResolvedCategoryDeleteImpact(impact: ResolvedCategoryDeleteImpact | null): ResolvedCategoryDeleteImpact {
  if (!impact) {
    throw new Error("分类删除失败。");
  }
  return impact;
}

interface SyncLogInsert {
  id: string;
  tableName: "categories" | "time_entries";
  recordId: string;
  action: "delete";
  timestamp: string;
  synced: 0;
}

export async function persistCategoryOrder(parentId: string | null, orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
    const siblings = (
      await db.categories.filter((category) => !category.isArchived && category.parentId === parentId).toArray()
    ).sort(compareCategoryOrder);
    const siblingIds = new Set(siblings.map((category) => category.id));

    if (orderedIds.length !== siblings.length || orderedIds.some((id) => !siblingIds.has(id))) {
      return;
    }

    const categoryById = new Map(siblings.map((category) => [category.id, category]));
    const updates = orderedIds
      .map((id, sortOrder) => {
        const category = categoryById.get(id);
        if (!category || category.sortOrder === sortOrder) return null;

        return {
          key: id,
          changes: { sortOrder, updatedAt: now },
        };
      })
      .filter((update): update is CategorySortUpdate => update !== null);

    if (updates.length === 0) return;

    await db.categories.bulkUpdate(updates);
    await updateAutoBackupCategoryFieldsBulk(updates.map((update) => ({ id: update.key, patch: update.changes })));
    await db.syncLog.bulkAdd(
      updates.map((update) => ({
        id: uuid(),
        tableName: "categories" as const,
        recordId: update.key,
        action: "update" as const,
        timestamp: now,
        synced: 0,
      })),
    );
  });
}

type CategoryBackupPatch = Partial<Pick<Category, "name" | "color" | "icon" | "sortOrder" | "isArchived" | "updatedAt">>;

interface CategoryBackupUpdate {
  key: string;
  changes: {
    categories: Category[];
  };
}

async function updateAutoBackupCategoryFields(categoryId: string, patch: CategoryBackupPatch): Promise<void> {
  await updateAutoBackupCategoryFieldsBulk([{ id: categoryId, patch }]);
}

async function updateAutoBackupCategoryFieldsBulk(patches: Array<{ id: string; patch: CategoryBackupPatch }>): Promise<void> {
  if (patches.length === 0) return;

  const patchById = new Map(patches.map(({ id, patch }) => [id, patch]));
  const backups = await db.autoBackups.toArray();
  const updates = backups
    .map((backup) => {
      let changed = false;
      const categories = backup.categories.map((category) => {
        const patch = patchById.get(category.id);
        if (!patch) return category;
        changed = true;
        return { ...category, ...patch };
      });
      return changed ? { key: backup.id, changes: { categories } } : null;
    })
    .filter((update): update is CategoryBackupUpdate => update !== null);

  if (updates.length === 0) return;

  await db.autoBackups.bulkUpdate(updates);
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("分类名称不能为空。");
  }

  await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
    const category = await db.categories.get(id);
    if (!category) {
      throw new Error("分类不存在。");
    }

    const duplicate = await db.categories
      .filter(
        (item) =>
          !item.isArchived && item.id !== id && item.parentId === category.parentId && item.name === trimmedName,
      )
      .first();

    if (duplicate) {
      throw new Error("同一层级下已存在同名分类。");
    }

    if (category.name === trimmedName) return;

    const now = new Date().toISOString();
    await db.categories.update(id, { name: trimmedName, updatedAt: now });
    await updateAutoBackupCategoryFields(id, { name: trimmedName, updatedAt: now });
    await recordSyncLog("categories", id, "update");
  });
}

async function categoryIdsForDelete(id: string): Promise<string[]> {
  const categories = await db.categories.toArray();
  const categoryIds = collectCategoryTreeIds(categories, id);
  if (categoryIds.length === 0) {
    throw new Error("分类不存在。");
  }

  return categoryIds;
}

async function resolveCategoryDeleteImpact(id: string): Promise<ResolvedCategoryDeleteImpact> {
  const categoryIds = await categoryIdsForDelete(id);
  const categoryIdSet = new Set(categoryIds);
  const entries = await db.timeEntries.filter((entry) => categoryIdSet.has(entry.categoryId)).toArray();

  return {
    categoryIds,
    childCount: categoryIds.length - 1,
    entryCount: entries.length,
    entries,
  };
}

export async function getCategoryDeleteImpact(id: string): Promise<CategoryDeleteImpact> {
  const impact = await resolveCategoryDeleteImpact(id);
  pendingDeleteImpact = { id, impact };
  const { entries: _entries, ...publicImpact } = impact;
  return publicImpact;
}

export async function deleteCategory(id: string): Promise<CategoryDeleteImpact> {
  let impact: ResolvedCategoryDeleteImpact | null = null;

  await db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    const resolved = pendingDeleteImpact?.id === id ? pendingDeleteImpact.impact : await resolveCategoryDeleteImpact(id);
    pendingDeleteImpact = null;
    const now = new Date().toISOString();
    const logs: SyncLogInsert[] = [
      ...resolved.entries.map((entry) => ({
        id: uuid(),
        tableName: "time_entries" as const,
        recordId: entry.id,
        action: "delete" as const,
        timestamp: now,
        synced: 0 as const,
      })),
      ...resolved.categoryIds.map((categoryId) => ({
        id: uuid(),
        tableName: "categories" as const,
        recordId: categoryId,
        action: "delete" as const,
        timestamp: now,
        synced: 0 as const,
      })),
    ];

    await db.timeEntries.bulkDelete(resolved.entries.map((entry) => entry.id));
    await db.categories.bulkDelete(resolved.categoryIds);
    if (logs.length > 0) {
      await db.syncLog.bulkAdd(logs);
    }

    impact = resolved;
  });

  const { entries: _entries, ...publicImpact } = requireResolvedCategoryDeleteImpact(impact);
  return publicImpact;
}

export async function updateCategoryColor(id: string, color: string): Promise<void> {
  const normalizedColor = normalizeCategoryColor(color);

  await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
    const category = await db.categories.get(id);
    if (!category) {
      throw new Error("分类不存在。");
    }
    if (category.parentId) {
      throw new Error("子分类颜色跟随父分类，不单独改色。");
    }
    if (category.color === normalizedColor) return;

    const now = new Date().toISOString();
    await db.categories.update(id, { color: normalizedColor, updatedAt: now });
    await updateAutoBackupCategoryFields(id, { color: normalizedColor, updatedAt: now });
    await recordSyncLog("categories", id, "update");
  });
}

export async function applyCategoryPalette(paletteId: CategoryColorPaletteId): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
    const parents = (
      await db.categories.filter((category) => !category.isArchived && category.parentId === null).toArray()
    ).sort(compareCategoryOrder);

    const updates = parents
      .map((category, index) => {
        const color = applyCategoryPaletteByIndex(paletteId, index);
        if (normalizeCategoryColor(category.color) === color) return null;
        return { key: category.id, changes: { color, updatedAt: now } };
      })
      .filter((update): update is { key: string; changes: { color: string; updatedAt: string } } => update !== null);

    if (updates.length === 0) return;

    await db.categories.bulkUpdate(updates);
    await updateAutoBackupCategoryFieldsBulk(updates.map((update) => ({ id: update.key, patch: update.changes })));
    await db.syncLog.bulkAdd(
      updates.map((update) => ({
        id: uuid(),
        tableName: "categories" as const,
        recordId: update.key,
        action: "update" as const,
        timestamp: now,
        synced: 0,
      })),
    );
  });
}

export async function archiveCategory(id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
    await db.categories.update(id, { isArchived: true, updatedAt: now });
    await updateAutoBackupCategoryFields(id, { isArchived: true, updatedAt: now });
    await recordSyncLog("categories", id, "update");
  });
}

export async function addCategory(name: string, parentId: string | null, color: string): Promise<Category> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("分类名称不能为空");

  return db.transaction("rw", db.categories, db.syncLog, async () => {
    const siblings = await db.categories.filter((category) => category.parentId === (parentId ?? null)).toArray();
    if (siblings.some((category) => !category.isArchived && category.name.trim() === trimmedName)) {
      throw new Error("同层级已存在同名分类");
    }

    const now = new Date().toISOString();
    const id = uuid();
    const cat: Category = {
      id,
      name: trimmedName,
      parentId,
      color,
      icon: null,
      sortOrder: siblings.filter((category) => !category.isArchived).length,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.categories.add(cat);
    await recordSyncLog("categories", id, "create");
    return cat;
  });
}

export function useCategories() {
  const categories =
    useLiveQuery(() => db.categories.filter((category) => !category.isArchived).sortBy("sortOrder")) || [];

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const parentCategories = useMemo(() => categories.filter((c) => c.parentId === null), [categories]);
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (c.parentId) {
        const list = map.get(c.parentId);
        if (list) list.push(c);
        else map.set(c.parentId, [c]);
      }
    }
    return map;
  }, [categories]);

  const getChildren = useCallback((parentId: string) => childrenByParentId.get(parentId) ?? [], [childrenByParentId]);

  const getCategoryPath = useCallback(
    (categoryId: string): string => {
      const cat = categoryById.get(categoryId);
      if (!cat) return "未知";
      if (!cat.parentId) return cat.name;
      const parent = categoryById.get(cat.parentId);
      return parent ? `${parent.name} · ${cat.name}` : cat.name;
    },
    [categoryById],
  );

  const getCategoryColor = useCallback(
    (categoryId: string): string => {
      const cat = categoryById.get(categoryId);
      if (!cat) return UNCATEGORIZED_COLOR;
      if (cat.parentId) {
        const parent = categoryById.get(cat.parentId);
        return parent?.color || cat.color;
      }
      return cat.color;
    },
    [categoryById],
  );

  async function updateCategory(
    id: string,
    updates: Partial<Pick<Category, "name" | "color" | "icon" | "sortOrder">>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction("rw", db.categories, db.syncLog, db.autoBackups, async () => {
      const normalizedUpdates = "color" in updates && typeof updates.color === "string" ? { ...updates, color: normalizeCategoryColor(updates.color) } : updates;
      await db.categories.update(id, { ...normalizedUpdates, updatedAt: now });
      await updateAutoBackupCategoryFields(id, { ...normalizedUpdates, updatedAt: now });
      await recordSyncLog("categories", id, "update");
    });
  }

  return {
    categories,
    parentCategories,
    getChildren,
    getCategoryPath,
    getCategoryColor,
    addCategory,
    updateCategory,
    updateCategoryColor,
    applyCategoryPalette,
    renameCategory,
    archiveCategory,
    deleteCategory,
    getCategoryDeleteImpact,
    reorderCategories: persistCategoryOrder,
  };
}
