import { arrayMove } from "@dnd-kit/sortable";
import type { Category } from "@timedata/shared";

export interface CategorySortOrderChange {
  id: string;
  sortOrder: number;
}

export function reorderCategoriesWithinParent(
  categories: Category[],
  activeId: string,
  overId: string,
  parentId: string | null,
): Category[] {
  const siblings = categories
    .filter((category) => !category.isArchived && category.parentId === parentId)
    .sort(compareCategoryOrder);
  const oldIndex = siblings.findIndex((category) => category.id === activeId);
  const newIndex = siblings.findIndex((category) => category.id === overId);

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return siblings.map((category, index) => ({ ...category, sortOrder: index }));
  }

  return arrayMove(siblings, oldIndex, newIndex).map((category, index) => ({
    ...category,
    sortOrder: index,
  }));
}

export function changedCategorySortOrders(before: Category[], after: Category[]): CategorySortOrderChange[] {
  const beforeById = new Map(before.map((category) => [category.id, category.sortOrder]));

  return after
    .filter((category) => beforeById.get(category.id) !== category.sortOrder)
    .map((category) => ({ id: category.id, sortOrder: category.sortOrder }));
}

export function compareCategoryOrder(a: Category, b: Category): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
