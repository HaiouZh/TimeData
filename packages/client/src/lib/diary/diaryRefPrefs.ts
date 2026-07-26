import { safeGetItem, safeSetItem } from "../safeStorage.js";
import { STORAGE_KEYS } from "../storageKeys.js";

export type DiaryRefBlock = "punches" | "doneTasks" | "quickNotes";

const KEY_BY_BLOCK: Record<DiaryRefBlock, string> = {
  punches: STORAGE_KEYS.diaryRefPunchesCollapsed,
  doneTasks: STORAGE_KEYS.diaryRefDoneTasksCollapsed,
  quickNotes: STORAGE_KEYS.diaryRefQuickNotesCollapsed,
};

// 「今天」三块未设偏好时一律展开：它们全是本地读、无网络代价，且正是起笔素材。
export function getDiaryRefCollapsed(block: DiaryRefBlock): boolean {
  return safeGetItem(KEY_BY_BLOCK[block]) === "true";
}

export function setDiaryRefCollapsed(block: DiaryRefBlock, collapsed: boolean): void {
  safeSetItem(KEY_BY_BLOCK[block], collapsed ? "true" : "false");
}
