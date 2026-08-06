import { safeGetItem, safeRemoveItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

/**
 * 浮窗草稿。**独立 key，不复用速记页的 `quickNoteComposerDraft`**：
 * 两个窗口同源共享 localStorage，共用一个 key 会让浮窗里打了一半的字跑进速记页输入框，
 * 反向亦然。形状与 quick-notes/composerDraft.ts 一致，只是 key 不同。
 */
export function readCaptureDraft(): string {
  return safeGetItem(STORAGE_KEYS.captureComposerDraft) ?? "";
}

export function writeCaptureDraft(text: string): void {
  if (text === "") {
    clearCaptureDraft();
    return;
  }
  safeSetItem(STORAGE_KEYS.captureComposerDraft, text);
}

export function clearCaptureDraft(): void {
  safeRemoveItem(STORAGE_KEYS.captureComposerDraft);
}
