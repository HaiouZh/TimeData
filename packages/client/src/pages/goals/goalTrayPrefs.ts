import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";

export const TRAY_WIDTH_MIN = 280;
export const TRAY_WIDTH_MAX = 640;
export const TRAY_WIDTH_DEFAULT = 320;

export function clampTrayWidth(px: number): number {
  if (!Number.isFinite(px)) return TRAY_WIDTH_DEFAULT;
  return Math.min(TRAY_WIDTH_MAX, Math.max(TRAY_WIDTH_MIN, Math.round(px)));
}

export function loadTrayWidth(): number {
  const raw = safeGetItem(STORAGE_KEYS.goalTrayWidth);
  if (raw === null) return TRAY_WIDTH_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampTrayWidth(parsed) : TRAY_WIDTH_DEFAULT;
}

export function saveTrayWidth(px: number): void {
  safeSetItem(STORAGE_KEYS.goalTrayWidth, String(clampTrayWidth(px)));
}
