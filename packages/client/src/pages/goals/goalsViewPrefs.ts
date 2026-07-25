import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";

export type GoalsViewMode = "galaxy" | "list";

/** 读手选偏好；null = 用户从未手选过（此时才允许按宽窄给默认）。 */
export function readGoalsViewMode(): GoalsViewMode | null {
  const raw = safeGetItem(STORAGE_KEYS.goalsViewMode);
  return raw === "galaxy" || raw === "list" ? raw : null;
}

export function writeGoalsViewMode(mode: GoalsViewMode): void {
  safeSetItem(STORAGE_KEYS.goalsViewMode, mode);
}

/**
 * 有偏好用偏好，无偏好按宽窄默认。纯函数，`GoalsPage` 消费。
 * 关键语义：一旦手选过，窗口尺寸翻转（平板旋转跨 1024px）就不再覆盖手选值。
 */
export function resolveGoalsViewMode(wide: boolean, stored: GoalsViewMode | null): GoalsViewMode {
  return stored ?? (wide ? "galaxy" : "list");
}
