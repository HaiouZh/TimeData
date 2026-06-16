import { getSetting, setSetting, useSetting } from "./index.js";

export const PUNCH_CATEGORY_KEY = "punch.categoryId.v1";

export function getPunchCategoryId(): Promise<string | null> {
  return getSetting(PUNCH_CATEGORY_KEY);
}

export function setPunchCategoryId(categoryId: string | null): Promise<void> {
  return setSetting(PUNCH_CATEGORY_KEY, categoryId);
}

export function usePunchCategoryId(): string | null {
  return useSetting(PUNCH_CATEGORY_KEY);
}
