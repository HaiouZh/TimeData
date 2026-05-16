import type { Category, SyncChange, TimeEntry } from "@timedata/shared";

export function categoryDependencyChangesForEntry(
  entry: TimeEntry,
  categories: Map<string, Category>,
  timestamp: string,
  includedCategoryIds: Set<string>,
): SyncChange[] {
  const category = categories.get(entry.categoryId);
  if (!category) return [];

  const changes: SyncChange[] = [];
  if (category.parentId) {
    const parent = categories.get(category.parentId);
    if (parent && !includedCategoryIds.has(parent.id)) {
      includedCategoryIds.add(parent.id);
      changes.push({
        tableName: "categories",
        recordId: parent.id,
        action: "update",
        data: parent,
        timestamp,
      });
    }
  }

  if (!includedCategoryIds.has(category.id)) {
    includedCategoryIds.add(category.id);
    changes.push({
      tableName: "categories",
      recordId: category.id,
      action: "update",
      data: category,
      timestamp,
    });
  }

  return changes;
}
