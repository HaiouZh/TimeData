// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../../test/domHarness.js";
import DiaryMarkdown from "./DiaryMarkdown.js";

describe("DiaryMarkdown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渲染标题与 wikilink 图片（经附件接口取 blob）", async () => {
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderDom(createElement(DiaryMarkdown, { content: "# 标题\n![[a.png]]" }));
    try {
      expect(host.querySelector("h1")?.textContent).toBe("标题");

      await vi.waitFor(() => {
        expect(host.querySelector('img[role="img"], img')).toBeTruthy();
      });

      const img = host.querySelector("img");
      expect(img).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/diary/asset?path=a.png"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    } finally {
      await unmount(root);
    }
  });

  it("不渲染原始 script 标签（react-markdown 默认转义）", async () => {
    const { host, root } = await renderDom(
      createElement(DiaryMarkdown, { content: "<script>alert(1)</script>" }),
    );
    try {
      expect(host.querySelector("script")).toBeNull();
    } finally {
      await unmount(root);
    }
  });
});
