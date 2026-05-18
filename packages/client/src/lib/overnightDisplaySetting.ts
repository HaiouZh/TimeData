import { safeGetItem, safeSetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export function getMergeOvernightEnabled(): boolean {
  return safeGetItem(STORAGE_KEYS.mergeOvernight) !== "false";
}

export function setMergeOvernightEnabled(enabled: boolean): void {
  safeSetItem(STORAGE_KEYS.mergeOvernight, enabled ? "true" : "false");
}
