import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";

export type BoardView = "flat" | "grouped";

export function loadBoardView(): BoardView {
  return safeGetItem(STORAGE_KEYS.tracksBoardView) === "grouped" ? "grouped" : "flat";
}

export function saveBoardView(view: BoardView): void {
  safeSetItem(STORAGE_KEYS.tracksBoardView, view);
}
