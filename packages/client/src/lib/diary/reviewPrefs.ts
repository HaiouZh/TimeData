import { safeGetItem, safeSetItem } from "../safeStorage.js";
import { STORAGE_KEYS } from "../storageKeys.js";

export type ReviewMode = "A" | "B" | "C";
export type ReviewLayoutB = "grid" | "list";

const YEAR_RANGE_DEFAULT = 5;
const YEAR_RANGE_MIN = 1;
const YEAR_RANGE_MAX = 10;
const MODE_DEFAULT: ReviewMode = "A";
const LAYOUT_B_DEFAULT: ReviewLayoutB = "grid";

export function getReviewYearRange(): number {
  const raw = safeGetItem(STORAGE_KEYS.diaryReviewYearRange);
  if (raw === null) return YEAR_RANGE_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return YEAR_RANGE_DEFAULT;
  return Math.min(YEAR_RANGE_MAX, Math.max(YEAR_RANGE_MIN, parsed));
}

export function setReviewYearRange(years: number): void {
  const clamped = Math.min(YEAR_RANGE_MAX, Math.max(YEAR_RANGE_MIN, years));
  safeSetItem(STORAGE_KEYS.diaryReviewYearRange, String(clamped));
}

export function getReviewMode(): ReviewMode {
  const raw = safeGetItem(STORAGE_KEYS.diaryReviewMode);
  return raw === "A" || raw === "B" || raw === "C" ? raw : MODE_DEFAULT;
}

export function setReviewMode(mode: ReviewMode): void {
  safeSetItem(STORAGE_KEYS.diaryReviewMode, mode);
}

export function getReviewLayoutB(): ReviewLayoutB {
  const raw = safeGetItem(STORAGE_KEYS.diaryReviewLayoutB);
  return raw === "grid" || raw === "list" ? raw : LAYOUT_B_DEFAULT;
}

export function setReviewLayoutB(layout: ReviewLayoutB): void {
  safeSetItem(STORAGE_KEYS.diaryReviewLayoutB, layout);
}
