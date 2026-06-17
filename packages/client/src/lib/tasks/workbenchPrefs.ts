import { safeGetItem, safeSetItem } from "../safeStorage.js";
import { STORAGE_KEYS } from "../storageKeys.js";

export const SPLIT_MIN = 0.35;
export const SPLIT_MAX = 0.7;
export const SPLIT_DEFAULT = 0.62;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

export function loadSplitRatio(): number {
  const raw = safeGetItem(STORAGE_KEYS.todoWorkbenchSplit);
  if (raw === null) return SPLIT_DEFAULT;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampSplitRatio(parsed) : SPLIT_DEFAULT;
}

export function saveSplitRatio(ratio: number): void {
  safeSetItem(STORAGE_KEYS.todoWorkbenchSplit, String(clampSplitRatio(ratio)));
}

export function getDoneCollapsed(): boolean {
  return safeGetItem(STORAGE_KEYS.todoDoneCollapsed) === "true";
}

export function setDoneCollapsed(collapsed: boolean): void {
  safeSetItem(STORAGE_KEYS.todoDoneCollapsed, collapsed ? "true" : "false");
}
