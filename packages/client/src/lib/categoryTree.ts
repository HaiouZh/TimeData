import type { Category } from "@timedata/shared";
import { compareCategoryOrder } from "./categorySort.js";

export function collectCategoryTreeIds(categories: ReadonlyArray<Category>, rootId: string): string[] {
  const target = categories.find((category) => category.id === rootId);
  if (!target) return [];

  const childrenByParentId = new Map<string, Category[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const children = childrenByParentId.get(category.parentId);
    if (children) children.push(category);
    else childrenByParentId.set(category.parentId, [category]);
  }

  const ids: string[] = [];
  const visit = (category: Category) => {
    for (const child of [...(childrenByParentId.get(category.id) ?? [])].sort(compareCategoryOrder)) {
      visit(child);
    }
    ids.push(category.id);
  };

  visit(target);
  return ids;
}
