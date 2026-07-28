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
        expect(host.querySelector("img")).toBeTruthy();
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

  it("基础 Markdown 语法渲染成对应元素并带排版类（preflight 清零后必须自己给）", async () => {
    const content = "# 大标题\n\n## 小标题\n\n**粗体** 与 *斜体*\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引用\n";
    const { host, root } = await renderDom(createElement(DiaryMarkdown, { content }));
    try {
      const h1 = host.querySelector("h1");
      expect(h1?.textContent).toBe("大标题");
      // 光解析出 <h1> 不够：Tailwind preflight 把标题字号/字重清零，没有 td-text-* 类
      // 用户看到的仍是一坨与正文无异的纯文本（这正是「回顾页不渲染 md」的根因）。
      expect(h1?.className).toContain("td-text-title");
      expect(host.querySelector("h2")?.textContent).toBe("小标题");
      expect(host.querySelector("h2")?.className).toContain("font-semibold");

      expect(host.querySelector("strong")?.textContent).toBe("粗体");
      expect(host.querySelector("em")?.textContent).toBe("斜体");

      const ul = host.querySelector("ul");
      expect(ul?.querySelectorAll("li")).toHaveLength(2);
      expect(ul?.className).toContain("list-disc");

      const ol = host.querySelector("ol");
      expect(ol?.querySelectorAll("li")).toHaveLength(2);
      expect(ol?.className).toContain("list-decimal");

      expect(host.querySelector("blockquote")?.textContent).toContain("引用");
    } finally {
      await unmount(root);
    }
  });

  it("外链图片走普通 <img>，绝不带 Authorization（token 不外泄）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("timedata_api_token", "super-secret");

    const { host, root } = await renderDom(
      createElement(DiaryMarkdown, { content: "![外链](https://evil.example/x.png)" }),
    );
    try {
      const img = host.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://evil.example/x.png");
      // 关键断言：外链一次 fetch 都不该发（发了就意味着带上了 Authorization 头）。
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem("timedata_api_token");
      await unmount(root);
    }
  });

  it("data: 图片不放行，降级为文件名/alt 占位且不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderDom(
      createElement(DiaryMarkdown, { content: "![占位](data:text/html,<b>x</b>)" }),
    );
    try {
      expect(host.querySelector("img")).toBeNull();
      expect(host.textContent).toContain("占位");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await unmount(root);
    }
  });

  it("附件名含空格时 asset URL 编码正确（不丢图）", async () => {
    const blob = new Blob(["bytes"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);

    const { root } = await renderDom(createElement(DiaryMarkdown, { content: "![[附件/my photo.png]]" }));
    try {
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("path=%E9%99%84%E4%BB%B6/my%20photo.png");
    } finally {
      await unmount(root);
    }
  });

  it("附件 fetch 失败时降级为 alt 文本", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, blob: () => Promise.reject(new Error("x")) });
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderDom(createElement(DiaryMarkdown, { content: "![丢了](td-asset-nope.png)" }));
    try {
      await vi.waitFor(() => {
        expect(host.textContent).toContain("丢了");
      });
      expect(host.querySelector("img")).toBeNull();
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
