import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

// 用户指定哪个父分类是「睡眠」，用于数据洞察中的作息、覆盖率和异常判定。null = 未指定。
// 正式入口：/settings/insights。
export function getSleepCategoryId(): string | null {
  const value = safeGetItem(STORAGE_KEYS.sleepCategoryId);
  return value && value.length > 0 ? value : null;
}

export function setSleepCategoryId(categoryId: string | null): void {
  if (categoryId) safeSetItem(STORAGE_KEYS.sleepCategoryId, categoryId);
  else safeRemoveItem(STORAGE_KEYS.sleepCategoryId);
}
