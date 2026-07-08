import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";

export const GANTT_WIDTH_MIN = 360;
export const GANTT_WIDTH_DEFAULT = 560;
// 左栏列表的可读底线：甘特最多吃到 视口宽 − 此值，无绝对像素硬顶。
export const LIST_MIN_WIDTH = 420;

export function ganttWidthMax(viewportWidth: number): number {
  return Math.max(GANTT_WIDTH_MIN, Math.round(viewportWidth) - LIST_MIN_WIDTH);
}

export function clampGanttWidth(px: number, viewportWidth: number): number {
  if (!Number.isFinite(px)) return Math.min(GANTT_WIDTH_DEFAULT, ganttWidthMax(viewportWidth));
  return Math.min(ganttWidthMax(viewportWidth), Math.max(GANTT_WIDTH_MIN, Math.round(px)));
}

export function loadGanttWidth(viewportWidth: number): number {
  const raw = safeGetItem(STORAGE_KEYS.trackGanttWidth);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return clampGanttWidth(Number.isFinite(parsed) ? parsed : GANTT_WIDTH_DEFAULT, viewportWidth);
}

export function saveGanttWidth(px: number, viewportWidth: number): void {
  safeSetItem(STORAGE_KEYS.trackGanttWidth, String(clampGanttWidth(px, viewportWidth)));
}
