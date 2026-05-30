import { getSetting, setSetting, useSetting } from "./settings/index.ts";

export const SLEEP_CATEGORY_KEY = "sleep.categoryId";

export function getSleepCategoryId(): Promise<string | null> {
  return getSetting(SLEEP_CATEGORY_KEY);
}

export function setSleepCategoryId(categoryId: string | null): Promise<void> {
  return setSetting(SLEEP_CATEGORY_KEY, categoryId);
}

export function useSleepCategoryId(): string | null {
  return useSetting(SLEEP_CATEGORY_KEY);
}
