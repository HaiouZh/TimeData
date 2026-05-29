import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

// 用户指定哪个父分类是「睡眠」，用于异常洞察排除睡眠。null = 未指定。
// 注：本期入口内联在统计页；正式设置入口待第五期迁入 /settings。
export function getSleepCategoryId(): string | null {
  const value = safeGetItem(STORAGE_KEYS.sleepCategoryId);
  return value && value.length > 0 ? value : null;
}

export function setSleepCategoryId(categoryId: string | null): void {
  if (categoryId) safeSetItem(STORAGE_KEYS.sleepCategoryId, categoryId);
  else safeRemoveItem(STORAGE_KEYS.sleepCategoryId);
}
