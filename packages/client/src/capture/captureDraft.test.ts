import { beforeEach, describe, expect, it } from "vitest";
import { readComposerDraft, writeComposerDraft } from "../quick-notes/composerDraft.js";
import { clearCaptureDraft, readCaptureDraft, writeCaptureDraft } from "./captureDraft.js";

beforeEach(() => {
  localStorage.clear();
});

describe("浮窗草稿与速记页草稿互不串味", () => {
  it("写浮窗草稿不改速记页草稿", () => {
    writeComposerDraft("速记页打了一半");
    writeCaptureDraft("浮窗打了一半");
    expect(readComposerDraft()).toBe("速记页打了一半");
    expect(readCaptureDraft()).toBe("浮窗打了一半");
  });

  it("写速记页草稿不改浮窗草稿", () => {
    writeCaptureDraft("浮窗打了一半");
    writeComposerDraft("速记页打了一半");
    expect(readCaptureDraft()).toBe("浮窗打了一半");
  });

  it("清浮窗草稿不影响速记页", () => {
    writeComposerDraft("速记页的");
    writeCaptureDraft("浮窗的");
    clearCaptureDraft();
    expect(readCaptureDraft()).toBe("");
    expect(readComposerDraft()).toBe("速记页的");
  });

  it("无值时返回空串", () => {
    expect(readCaptureDraft()).toBe("");
  });
});
