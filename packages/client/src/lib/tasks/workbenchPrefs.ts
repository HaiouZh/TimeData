import { safeGetItem, safeSetItem } from "../safeStorage.js";
import { STORAGE_KEYS } from "../storageKeys.js";

export const SPLIT_MIN = 0.35;
export const SPLIT_MAX = 0.7;
export const SPLIT_DEFAULT = 0.62;

/** 分栏偏好：存储键与取值范围捆在一起传，避免调用方只传键、静默用错范围。 */
export interface SplitPrefs {
  storageKey: string;
  min: number;
  max: number;
  defaultRatio: number;
}

export const TODO_SPLIT_PREFS: SplitPrefs = {
  storageKey: STORAGE_KEYS.todoWorkbenchSplit,
  min: SPLIT_MIN,
  max: SPLIT_MAX,
  defaultRatio: SPLIT_DEFAULT,
};

export const DIARY_SPLIT_PREFS: SplitPrefs = {
  storageKey: STORAGE_KEYS.diarySplit,
  min: 0.5,
  max: 0.85,
  defaultRatio: 0.7,
};

export function clampSplitRatio(ratio: number, prefs: SplitPrefs = TODO_SPLIT_PREFS): number {
  if (!Number.isFinite(ratio)) return prefs.defaultRatio;
  return Math.min(prefs.max, Math.max(prefs.min, ratio));
}

export function loadSplitRatio(prefs: SplitPrefs = TODO_SPLIT_PREFS): number {
  const raw = safeGetItem(prefs.storageKey);
  if (raw === null) return prefs.defaultRatio;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampSplitRatio(parsed, prefs) : prefs.defaultRatio;
}

export function saveSplitRatio(ratio: number, prefs: SplitPrefs = TODO_SPLIT_PREFS): void {
  safeSetItem(prefs.storageKey, String(clampSplitRatio(ratio, prefs)));
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
