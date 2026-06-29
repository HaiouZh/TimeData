// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { cleanupRoots, renderDom, unmount } from "./domHarness.js";

describe("cleanupRoots", () => {
  it("unmounts roots a test left mounted", async () => {
    await renderDom(createElement("div", null, "a"));
    await renderDom(createElement("div", null, "b"));
    expect(document.body.children.length).toBe(2);

    await cleanupRoots();
    expect(document.body.children.length).toBe(0);
  });

  it("is idempotent and skips roots already unmounted manually", async () => {
    const { root } = await renderDom(createElement("div", null, "kept"));
    await unmount(root);
    expect(document.body.children.length).toBe(0);

    // 已手动 unmount 的不应被再次处理（不抛错）
    await cleanupRoots();
    await cleanupRoots();
    expect(document.body.children.length).toBe(0);
  });
});
