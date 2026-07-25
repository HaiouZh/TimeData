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
  // 已完成升级为顶级分区后默认展开（一级展开，内部渐进式 3 组承担节流）。
  return safeGetItem(STORAGE_KEYS.todoDoneCollapsed) === "true";
}

export function setDoneCollapsed(collapsed: boolean): void {
  safeSetItem(STORAGE_KEYS.todoDoneCollapsed, collapsed ? "true" : "false");
}

export function getInboxCollapsed(): boolean {
  // 未设偏好时默认展开：收件箱是常用入口。
  return safeGetItem(STORAGE_KEYS.todoInboxCollapsed) === "true";
}

export function setInboxCollapsed(collapsed: boolean): void {
  safeSetItem(STORAGE_KEYS.todoInboxCollapsed, collapsed ? "true" : "false");
}

export function getScheduledCollapsed(): boolean {
  // 已排期默认折叠：未到期 / 未来任务作管理列表，不抢注意力。
  const raw = safeGetItem(STORAGE_KEYS.todoScheduledCollapsed);
  return raw === null ? true : raw === "true";
}

export function setScheduledCollapsed(collapsed: boolean): void {
  safeSetItem(STORAGE_KEYS.todoScheduledCollapsed, collapsed ? "true" : "false");
}

export function getProjectZoneIntroDismissed(): boolean {
  // 未设偏好时提示条要出现：归属轴排他打开的那一版，用户需要知道任务去哪了。
  // 它同时是项目区「首次默认展开」的判据——没读过说明就先把内容摊开。
  return safeGetItem(STORAGE_KEYS.todoProjectZoneIntroDismissed) === "true";
}

export function setProjectZoneIntroDismissed(dismissed: boolean): void {
  safeSetItem(STORAGE_KEYS.todoProjectZoneIntroDismissed, dismissed ? "true" : "false");
}
