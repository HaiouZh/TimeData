import type { Category, TimeEntry } from "@timedata/shared";

/**
 * 跨记录业务关系层校验。
 * 形状（字段格式 / 类型）请通过 shared schema（CategorySchema / TimeEntrySchema）先验。
 * 本函数假定输入已通过形状校验。
 */
export function validateForcePushBusinessRules(
  categories: Category[],
  timeEntries: TimeEntry[],
): string | null {
  const categoryIds = new Set<string>();
  for (const c of categories) {
    if (categoryIds.has(c.id)) return `duplicate category ${c.id}`;
    categoryIds.add(c.id);
  }

  for (const c of categories) {
    if (c.parentId === c.id) return `category ${c.id} references itself`;
    if (c.parentId && !categoryIds.has(c.parentId)) return `missing parent category ${c.parentId}`;
    if (c.parentId) {
      const parent = categories.find((x) => x.id === c.parentId);
      if (parent && parent.parentId !== null) return `category ${c.id} would create a third level`;
    }
  }

  const entryIds = new Set<string>();
  for (const e of timeEntries) {
    if (entryIds.has(e.id)) return `duplicate entry ${e.id}`;
    entryIds.add(e.id);
    if (!categoryIds.has(e.categoryId)) return `missing category ${e.categoryId}`;
  }

  const sorted = [...timeEntries].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].endTime > sorted[i].startTime) {
      return `overlapping entries ${sorted[i - 1].id} and ${sorted[i].id}`;
    }
  }

  return null;
}
