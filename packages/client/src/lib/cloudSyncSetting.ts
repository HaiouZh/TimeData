import { safeGetItem, safeSetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export function getCloudSyncEnabled(): boolean {
  const saved = safeGetItem(STORAGE_KEYS.cloudSyncEnabled);
  if (saved === "true") return true;
  if (saved === "false") return false;
  return Boolean(safeGetItem(STORAGE_KEYS.apiUrl));
}

export function setCloudSyncEnabled(enabled: boolean): void {
  safeSetItem(STORAGE_KEYS.cloudSyncEnabled, enabled ? "true" : "false");
}
