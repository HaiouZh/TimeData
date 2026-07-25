import { safeGetItem, safeRemoveItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

/** 读未发出的 compose 草稿；无值返回 ""。只存本地、不进同步域。 */
export function readComposerDraft(): string {
  return safeGetItem(STORAGE_KEYS.quickNoteComposerDraft) ?? "";
}

/**
 * 写未发出的 compose 草稿。空串等价于清除，不在 localStorage 里留空条目。
 * 不设长度上限：速记正文远达不到配额，而截断会静默改用户内容，比写不进去更坏；
 * 写失败由 safeSetItem 静默吞掉，降级为「不持久化」，与改动前的行为一致。
 */
export function writeComposerDraft(text: string): void {
  if (text === "") {
    clearComposerDraft();
    return;
  }
  safeSetItem(STORAGE_KEYS.quickNoteComposerDraft, text);
}

export function clearComposerDraft(): void {
  safeRemoveItem(STORAGE_KEYS.quickNoteComposerDraft);
}

/**
 * 编辑态下「改过没」。按 trim 比：updateQuickNote 会 normalize，
 * 只在首尾多打空格的情况保存后结果一样，不该拦用户。
 */
export function isEditDraftDirty(draft: string, original: string): boolean {
  return draft.trim() !== original.trim();
}
