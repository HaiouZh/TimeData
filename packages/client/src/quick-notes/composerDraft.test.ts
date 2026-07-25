import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { clearComposerDraft, isEditDraftDirty, readComposerDraft, writeComposerDraft } from "./composerDraft.js";

describe("composerDraft 本地持久化", () => {
  it("无值时读出空串", () => {
    expect(readComposerDraft()).toBe("");
  });

  it("写入后读出同一份文本", () => {
    writeComposerDraft("半条速记");
    expect(readComposerDraft()).toBe("半条速记");
    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("半条速记");
  });

  it("写空串等价于清除，不留空条目", () => {
    writeComposerDraft("先有内容");
    writeComposerDraft("");
    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBeNull();
    expect(readComposerDraft()).toBe("");
  });

  it("clear 之后读出空串", () => {
    writeComposerDraft("待清除");
    clearComposerDraft();
    expect(readComposerDraft()).toBe("");
  });

  it("原样保留换行与首尾空格（草稿是用户没写完的原文，不许 normalize）", () => {
    writeComposerDraft("  第一行\n第二行  ");
    expect(readComposerDraft()).toBe("  第一行\n第二行  ");
  });
});

describe("isEditDraftDirty", () => {
  it("文本相同不算改过", () => {
    expect(isEditDraftDirty("原文", "原文")).toBe(false);
  });

  it("只在首尾多空格不算改过（updateQuickNote 会 normalize，保存后结果一样）", () => {
    expect(isEditDraftDirty("  原文 ", "原文")).toBe(false);
  });

  it("正文改过算改过", () => {
    expect(isEditDraftDirty("原文改了", "原文")).toBe(true);
  });

  it("清空正文算改过", () => {
    expect(isEditDraftDirty("", "原文")).toBe(true);
  });
});
