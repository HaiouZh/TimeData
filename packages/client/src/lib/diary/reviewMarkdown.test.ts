import { describe, expect, it } from "vitest";
import { preprocessDiaryMarkdown } from "./reviewMarkdown.js";

describe("preprocessDiaryMarkdown", () => {
  it("wikilink 图片转标准语法", () => {
    expect(preprocessDiaryMarkdown("![[photo.png]]")).toBe("![](td-asset:photo.png)");
    expect(preprocessDiaryMarkdown("![[a/b.jpg|风景]]")).toBe("![风景](td-asset:a/b.jpg)");
  });

  it("内部链接降为纯文本", () => {
    expect(preprocessDiaryMarkdown("见 [[2026-01-01]] 和 [[页面|别名]]")).toBe("见 2026-01-01 和 别名");
  });

  it("正文里裸文件名不被当图片（贪婪匹配反例）", () => {
    expect(preprocessDiaryMarkdown("今天整理了 a.png 这个文件")).toBe("今天整理了 a.png 这个文件");
  });

  it("非图片嵌入降为文件名", () => {
    expect(preprocessDiaryMarkdown("![[笔记.md]]")).toBe("笔记.md");
  });
});
